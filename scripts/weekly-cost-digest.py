"""
Queries New Relic for AWS project costs (AwsProjectCost + AwsProjectServiceCost)
and writes a professional HTML email body to stdout for the weekly digest.

Required env vars:
  NR_API_KEY    — New Relic User API key (for NerdGraph)
  NR_ACCOUNT_ID — New Relic account ID
  INR_RATE      — USD → INR rate used in display (default: 92)
  OUTPUT_FILE   — path to write HTML (default: digest.html)
"""

import os
import sys
import json
import requests
from datetime import datetime, timezone, timedelta
from collections import defaultdict

NR_API_KEY    = os.environ['NR_API_KEY']
NR_ACCOUNT_ID = os.environ['NR_ACCOUNT_ID']
OUTPUT_FILE   = os.environ.get('OUTPUT_FILE', 'digest.html')

NERDGRAPH_URL = 'https://api.newrelic.com/graphql'

now           = datetime.now(timezone.utc)
month_start   = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
week_start    = now - timedelta(days=7)
date_label    = f"{month_start.strftime('%d %b')} – {now.strftime('%d %b %Y')}"


def nrql(query):
    gql = {
        "query": """
        {
          actor {
            account(id: %s) {
              nrql(query: "%s") {
                results
              }
            }
          }
        }
        """ % (NR_ACCOUNT_ID, query.replace('"', '\\"'))
    }
    resp = requests.post(
        NERDGRAPH_URL,
        headers={'Api-Key': NR_API_KEY, 'Content-Type': 'application/json'},
        json=gql,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    errors = data.get('errors')
    if errors:
        print(f'NerdGraph errors: {errors}', file=sys.stderr)
        return []
    return data['data']['actor']['account']['nrql']['results']


# ── Fetch project totals ─────────────────────────────────────────────────────

print('Querying project totals…')
totals_rows = nrql(
    "SELECT latest(costINR) AS costINR, latest(costUSD) AS costUSD "
    "FROM AwsProjectCost FACET projectName SINCE this month LIMIT 100"
)

# totals_rows: [{"projectName": "dms", "costINR": 253.4, "costUSD": 2.75}, ...]
projects = {}
for row in totals_rows:
    name = row.get('facet') or row.get('projectName', '')
    if not name:
        continue
    projects[name] = {
        'costINR': row.get('costINR') or row.get('latest.costINR') or 0,
        'costUSD': row.get('costUSD') or row.get('latest.costUSD') or 0,
        'services': [],
    }

if not projects:
    print('No project cost data found in New Relic — writing placeholder email.')
    placeholder = f"""<!DOCTYPE html><html><body style="font-family:sans-serif;padding:32px;">
<h2 style="color:#4c1d95;">AWS Cost Digest — {now.strftime('%d %b %Y')}</h2>
<p style="color:#555;">No cost data is available yet in New Relic for this month ({date_label}).<br>
The sync pipeline may still be initializing — data will appear in the next digest.</p>
</body></html>"""
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(placeholder)
    print(f'Placeholder written to {OUTPUT_FILE}')
    sys.exit(0)

print(f'Found {len(projects)} project(s): {", ".join(projects.keys())}')


# ── Fetch per-service breakdown ──────────────────────────────────────────────

print('Querying service breakdown…')
svc_rows = nrql(
    "SELECT latest(costINR) AS costINR "
    "FROM AwsProjectServiceCost FACET projectName, serviceName SINCE this month LIMIT 500"
)

for row in svc_rows:
    facets = row.get('facet', [])
    if isinstance(facets, list) and len(facets) == 2:
        proj_name, svc_name = facets[0], facets[1]
    else:
        proj_name = row.get('projectName', '')
        svc_name  = row.get('serviceName', '')
    cost_inr = row.get('costINR') or row.get('latest.costINR') or 0
    if proj_name in projects and cost_inr > 0:
        projects[proj_name]['services'].append({
            'name': svc_name,
            'costINR': cost_inr,
        })

# Sort services within each project by cost descending
for p in projects.values():
    p['services'].sort(key=lambda s: s['costINR'], reverse=True)

grand_total = sum(p['costINR'] for p in projects.values())


# ── Build HTML ───────────────────────────────────────────────────────────────

def fmt_inr(val):
    return f"₹{val:,.2f}"

def service_rows_html(services):
    if not services:
        return '<tr><td colspan="2" style="color:#888;font-size:13px;padding:6px 12px;">No service-level data available</td></tr>'
    rows = ''
    for svc in services:
        rows += f"""
        <tr>
          <td style="padding:6px 16px 6px 28px;font-size:13px;color:#555;border-bottom:1px solid #f0f0f0;">
            {svc['name']}
          </td>
          <td style="padding:6px 16px;font-size:13px;color:#555;text-align:right;border-bottom:1px solid #f0f0f0;white-space:nowrap;">
            {fmt_inr(svc['costINR'])}
          </td>
        </tr>"""
    return rows

def project_blocks_html():
    blocks = ''
    # Sort projects by cost descending
    sorted_projects = sorted(projects.items(), key=lambda kv: kv[1]['costINR'], reverse=True)
    for proj_name, data in sorted_projects:
        pct = (data['costINR'] / grand_total * 100) if grand_total > 0 else 0
        svc_html = service_rows_html(data['services'])
        blocks += f"""
        <div style="margin-bottom:24px;border:1px solid #e8e8e8;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
          <!-- Project header -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:linear-gradient(135deg,#6c3fc5 0%,#8b5cf6 100%);">
            <tr>
              <td style="padding:14px 20px;">
                <span style="font-size:15px;font-weight:700;color:#fff;text-transform:capitalize;">{proj_name}</span>
                <span style="font-size:12px;color:rgba(255,255,255,0.75);margin-left:10px;">({pct:.1f}% of total)</span>
              </td>
              <td style="padding:14px 20px;text-align:right;">
                <span style="font-size:18px;font-weight:800;color:#fff;">{fmt_inr(data['costINR'])}</span>
              </td>
            </tr>
          </table>
          <!-- Service breakdown -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;">
            <tr>
              <th style="padding:8px 16px 8px 28px;font-size:11px;font-weight:600;color:#9ca3af;text-align:left;text-transform:uppercase;letter-spacing:0.5px;background:#fafafa;border-bottom:1px solid #f0f0f0;">Service</th>
              <th style="padding:8px 16px;font-size:11px;font-weight:600;color:#9ca3af;text-align:right;text-transform:uppercase;letter-spacing:0.5px;background:#fafafa;border-bottom:1px solid #f0f0f0;">Cost (INR)</th>
            </tr>
            {svc_html}
          </table>
        </div>"""
    return blocks

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Weekly AWS Cost Digest</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f7;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

  <!-- Header / Logo -->
  <tr>
    <td style="background:linear-gradient(135deg,#4c1d95 0%,#6c3fc5 60%,#8b5cf6 100%);border-radius:12px 12px 0 0;padding:32px 36px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
            <div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Tibil Solutions</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.65);margin-top:2px;letter-spacing:1px;text-transform:uppercase;">Data. Decision. Action.</div>
          </td>
          <td style="text-align:right;vertical-align:top;">
            <div style="font-size:11px;color:rgba(255,255,255,0.6);text-align:right;">Weekly Report</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.9);font-weight:600;text-align:right;margin-top:2px;">{now.strftime('%d %b %Y')}</div>
          </td>
        </tr>
      </table>
      <div style="margin-top:24px;">
        <div style="font-size:28px;font-weight:800;color:#fff;">AWS Cost Digest</div>
        <div style="font-size:14px;color:rgba(255,255,255,0.75);margin-top:4px;">Month-to-date: {date_label}</div>
      </div>
    </td>
  </tr>

  <!-- Grand Total Banner -->
  <tr>
    <td style="background:#fff;padding:0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"
             style="background:#f9f5ff;border-bottom:2px solid #ede9fe;">
        <tr>
          <td style="padding:20px 36px;">
            <div style="font-size:12px;font-weight:600;color:#7c3aed;text-transform:uppercase;letter-spacing:1px;">Total AWS Spend (MTD)</div>
            <div style="font-size:36px;font-weight:800;color:#4c1d95;margin-top:4px;">{fmt_inr(grand_total)}</div>
            <div style="font-size:13px;color:#6d28d9;margin-top:2px;">Across {len(projects)} project(s)</div>
          </td>
          <td style="padding:20px 36px;text-align:right;vertical-align:middle;">
            <div style="display:inline-block;background:linear-gradient(135deg,#6c3fc5,#8b5cf6);border-radius:50px;padding:8px 20px;">
              <span style="font-size:13px;font-weight:700;color:#fff;">&#128200; {now.strftime('%B %Y')}</span>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Project Breakdown -->
  <tr>
    <td style="background:#fff;padding:28px 36px 32px;">
      <div style="font-size:16px;font-weight:700;color:#1f2937;margin-bottom:20px;">Project Breakdown</div>
      {project_blocks_html()}
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#1e1b4b;border-radius:0 0 12px 12px;padding:24px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
            <div style="font-size:13px;color:rgba(255,255,255,0.7);">
              Generated automatically every Friday by Eagle Eye &bull; Tibil Solutions
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:6px;">
              Data sourced from AWS Cost Explorer via New Relic. Costs are month-to-date in INR.
            </div>
          </td>
          <td style="text-align:right;vertical-align:middle;">
            <div style="font-size:11px;color:rgba(255,255,255,0.4);">{now.strftime('%d %b %Y, %H:%M UTC')}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>"""

with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    f.write(html)

print(f'\nHTML digest written to {OUTPUT_FILE}')
print(f'Grand total: {fmt_inr(grand_total)} across {len(projects)} project(s)')
