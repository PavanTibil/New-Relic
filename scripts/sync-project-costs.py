"""
Pulls month-to-date AWS costs via AWS Cost Explorer and pushes two event types
to New Relic so the Eagle Eye nerdlet and weekly digest can query billing:

  AwsProjectCost        — one row per project (grouped by `name` tag)
  AwsProjectServiceCost — one row per project+service (grouped by `name` tag + SERVICE dimension)

Required env vars:
  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
  NR_INGEST_KEY   — New Relic Insert API key (Ingest > License key)
  NR_ACCOUNT_ID   — New Relic account ID
  INR_RATE        — USD to INR conversion rate (default: 92)
  TAG_KEY         — Cost allocation tag key to group by (default: name)
"""

import boto3
import requests
import json
import os
import sys
from datetime import datetime, timedelta, timezone

TAG_KEY        = os.environ.get('TAG_KEY', 'name')
INR_RATE       = float(os.environ.get('INR_RATE', '92'))
NR_INGEST_KEY  = os.environ['NR_INGEST_KEY']
NR_ACCOUNT_ID  = os.environ['NR_ACCOUNT_ID']

NR_EVENTS_URL = f'https://insights-collector.newrelic.com/v1/accounts/{NR_ACCOUNT_ID}/events'

now         = datetime.now(timezone.utc)
month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
start_str   = month_start.strftime('%Y-%m-%d')
end_str     = now.strftime('%Y-%m-%d')

# Cost Explorer end date must be strictly after start date
if start_str == end_str:
    end_str = (now + timedelta(days=1)).strftime('%Y-%m-%d')

print(f'Fetching costs {start_str} → {end_str} grouped by tag:{TAG_KEY}')

ce = boto3.client('ce', region_name='us-east-1')


def push_events(events, label):
    if not events:
        print(f'No {label} events to push.')
        return
    resp = requests.post(
        NR_EVENTS_URL,
        headers={'Content-Type': 'application/json', 'Api-Key': NR_INGEST_KEY},
        data=json.dumps(events),
        timeout=30,
    )
    if resp.ok:
        print(f'New Relic accepted {len(events)} {label} event(s) (HTTP {resp.status_code})')
    else:
        print(f'New Relic rejected {label} events: {resp.status_code} {resp.text}', file=sys.stderr)
        sys.exit(1)


# ── 1. Project-level totals (GroupBy TAG only) ──────────────────────────────

try:
    resp_totals = ce.get_cost_and_usage(
        TimePeriod={'Start': start_str, 'End': end_str},
        Granularity='MONTHLY',
        Metrics=['UnblendedCost'],
        GroupBy=[{'Type': 'TAG', 'Key': TAG_KEY}],
    )
except Exception as e:
    print(f'Cost Explorer error (totals): {e}', file=sys.stderr)
    sys.exit(1)

project_events = []
for result in resp_totals.get('ResultsByTime', []):
    for group in result.get('Groups', []):
        raw_key      = group['Keys'][0]
        project_name = raw_key.split('$', 1)[-1].strip()
        if not project_name:
            continue
        cost_usd = float(group['Metrics']['UnblendedCost']['Amount'])
        if cost_usd < 0.0001:
            continue
        project_events.append({
            'eventType':   'AwsProjectCost',
            'projectName': project_name,
            'costUSD':     round(cost_usd, 6),
            'costINR':     round(cost_usd * INR_RATE, 2),
            'month':       start_str,
            'timestamp':   int(now.timestamp()),
        })

print(f'\nProject totals ({len(project_events)} projects):')
for e in project_events:
    print(f'  {e["projectName"]:20s}  ${e["costUSD"]:.4f} USD  =  ₹{e["costINR"]:.2f} INR')

push_events(project_events, 'AwsProjectCost')


# ── 2. Per-project per-service breakdown (GroupBy TAG + SERVICE) ─────────────

try:
    resp_svc = ce.get_cost_and_usage(
        TimePeriod={'Start': start_str, 'End': end_str},
        Granularity='MONTHLY',
        Metrics=['UnblendedCost'],
        GroupBy=[
            {'Type': 'TAG',       'Key': TAG_KEY},
            {'Type': 'DIMENSION', 'Key': 'SERVICE'},
        ],
    )
except Exception as e:
    print(f'Cost Explorer error (service breakdown): {e}', file=sys.stderr)
    sys.exit(1)

service_events = []
for result in resp_svc.get('ResultsByTime', []):
    for group in result.get('Groups', []):
        # Keys[0] = "name$<projectName>", Keys[1] = "<AWS Service Name>"
        tag_raw      = group['Keys'][0]
        service_name = group['Keys'][1]
        project_name = tag_raw.split('$', 1)[-1].strip()
        if not project_name or not service_name:
            continue
        cost_usd = float(group['Metrics']['UnblendedCost']['Amount'])
        if cost_usd < 0.0001:
            continue
        service_events.append({
            'eventType':   'AwsProjectServiceCost',
            'projectName': project_name,
            'serviceName': service_name,
            'costUSD':     round(cost_usd, 6),
            'costINR':     round(cost_usd * INR_RATE, 2),
            'month':       start_str,
            'timestamp':   int(now.timestamp()),
        })

print(f'\nService breakdown ({len(service_events)} rows):')
for e in service_events:
    print(f'  {e["projectName"]:20s}  {e["serviceName"]:40s}  ₹{e["costINR"]:.2f} INR')

push_events(service_events, 'AwsProjectServiceCost')
