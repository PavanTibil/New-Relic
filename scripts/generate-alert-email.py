"""
Generates a styled HTML alert email for New Relic alerts,
matching the weekly cost digest visual style.

Required env vars (passed from GitHub Actions workflow_dispatch payload):
  ALERT_NAME    — name of the alert policy/condition
  SEVERITY      — CRITICAL / WARNING / INFO
  MESSAGE       — alert message / description
  ALERT_TIME    — timestamp string (unix ms, unix s, or human-readable)
  ENTITY_NAME   — affected entity name
  OUTPUT_FILE   — path to write HTML (default: alert.html)
"""

import os
from datetime import datetime, timezone

ALERT_NAME   = os.environ.get('ALERT_NAME', 'Unknown Alert')
SEVERITY     = os.environ.get('SEVERITY', 'CRITICAL').upper()
MESSAGE      = os.environ.get('MESSAGE', 'No message provided.')
ENTITY_NAME  = os.environ.get('ENTITY_NAME', '—')
OUTPUT_FILE  = os.environ.get('OUTPUT_FILE', 'alert.html')

# Parse ALERT_TIME — handle unix ms, unix s, or plain string
_raw_time = os.environ.get('ALERT_TIME', '')
try:
    ts = int(_raw_time)
    if ts > 1e12:
        ts = ts / 1000  # ms → s
    ALERT_TIME = datetime.utcfromtimestamp(ts).strftime('%d %b %Y, %H:%M UTC')
except (ValueError, TypeError, OSError):
    ALERT_TIME = _raw_time if _raw_time else datetime.now(timezone.utc).strftime('%d %b %Y, %H:%M UTC')

now = datetime.now(timezone.utc)

SEVERITY_COLOR = {
    'CRITICAL': ('#dc2626', '#fef2f2', '#fee2e2'),
    'WARNING':  ('#d97706', '#fffbeb', '#fef3c7'),
    'INFO':     ('#2563eb', '#eff6ff', '#dbeafe'),
}.get(SEVERITY, ('#dc2626', '#fef2f2', '#fee2e2'))

sev_accent, sev_bg, sev_border = SEVERITY_COLOR

SEVERITY_ICON = {'CRITICAL': '🚨', 'WARNING': '⚠️', 'INFO': 'ℹ️'}.get(SEVERITY, '🚨')


# ── Build HTML ────────────────────────────────────────────────────────────────

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>New Relic Alert: {ALERT_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f7;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#4c1d95 0%,#6c3fc5 60%,#8b5cf6 100%);border-radius:12px 12px 0 0;padding:32px 36px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
            <div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Tibil Solutions</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.65);margin-top:2px;letter-spacing:1px;text-transform:uppercase;">Eagle Eye Monitoring</div>
          </td>
          <td style="text-align:right;vertical-align:top;">
            <div style="font-size:11px;color:rgba(255,255,255,0.6);">Alert Notification</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.9);font-weight:600;margin-top:2px;">{now.strftime('%d %b %Y')}</div>
          </td>
        </tr>
      </table>
      <div style="margin-top:24px;display:inline-block;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);border-radius:50px;padding:6px 16px;">
        <span style="font-size:13px;font-weight:700;color:#fff;">{SEVERITY_ICON} {SEVERITY}</span>
      </div>
    </td>
  </tr>

  <!-- Alert Banner -->
  <tr>
    <td style="background:{sev_bg};border-left:4px solid {sev_accent};padding:20px 36px;border-bottom:1px solid {sev_border};">
      <div style="font-size:18px;font-weight:800;color:{sev_accent};">{SEVERITY_ICON} {ALERT_NAME}</div>
      <div style="font-size:14px;color:#374151;margin-top:8px;line-height:1.6;">{MESSAGE}</div>
    </td>
  </tr>

  <!-- Details -->
  <tr>
    <td style="background:#fff;padding:28px 36px 20px;">
      <div style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:16px;">Alert Details</div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <tr style="background:#f9fafb;">
          <td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;width:35%;">Field</td>
          <td style="padding:10px 16px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #e5e7eb;">Value</td>
        </tr>
        <tr>
          <td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Severity</td>
          <td style="padding:12px 16px;font-size:13px;font-weight:600;color:{sev_accent};border-bottom:1px solid #f3f4f6;">{SEVERITY}</td>
        </tr>
        <tr style="background:#fafafa;">
          <td style="padding:12px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Entity</td>
          <td style="padding:12px 16px;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6;">{ENTITY_NAME}</td>
        </tr>
        <tr>
          <td style="padding:12px 16px;font-size:13px;color:#6b7280;">Time</td>
          <td style="padding:12px 16px;font-size:13px;color:#111827;">{ALERT_TIME}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#1e1b4b;border-radius:0 0 12px 12px;padding:24px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
            <div style="font-size:13px;color:rgba(255,255,255,0.7);">
              Automated alert from Eagle Eye &bull; Tibil Solutions
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:6px;">
              Powered by New Relic.
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

print(f'Alert HTML written to {OUTPUT_FILE}')
print(f'Severity: {SEVERITY} | Alert: {ALERT_NAME} | Entity: {ENTITY_NAME}')
