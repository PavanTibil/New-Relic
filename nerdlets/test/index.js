import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { NrqlQuery, navigation, AccountStorageMutation, AccountStorageQuery } from 'nr1';
import './styles.scss';

// ─── GitHub token context — lets any component read ghToken without prop-drilling
const GhTokenContext = React.createContext('');

// ─── Auto-discovered projects ─────────────────────────────────────────────────
let AUTO_DISCOVERED = {};
try {
  // eslint-disable-next-line global-require
  AUTO_DISCOVERED = require('./auto-discovered-projects.json');
} catch (_) {}

const mergeAutoDiscovered = (providers) => {
  if (!AUTO_DISCOVERED || Object.keys(AUTO_DISCOVERED).length === 0) return providers;
  const merged = providers.map(p => ({ ...p, projects: [...p.projects] }));
  for (const [dirName, discovered] of Object.entries(AUTO_DISCOVERED)) {
    const { provider, name } = discovered;
    if (!provider || !name) continue;
    const providerEntry = merged.find(p => p.id === provider);
    if (!providerEntry) continue;
    const alreadyExists = providerEntry.projects.some(
      p => p.name === name || p.projectDirName === dirName
    );
    if (alreadyExists) continue;
    providerEntry.projects.push({
      name,
      projectDirName: dirName,
      gcpProjectId:  discovered.gcpProjectId  || null,
      dashboardGuid: discovered.dashboardGuid || null,
      dashboardLink: discovered.dashboardLink || null,
      resources:     Array.isArray(discovered.resources)     ? discovered.resources     : [],
      knownServices: Array.isArray(discovered.knownServices) ? discovered.knownServices : [],
    });
  }
  return merged;
};

const ACCOUNT_ID         = 7782479;
const STORAGE_COLLECTION = 'eagle-eye';
const STORAGE_DOC_ID     = 'providers';
const STORAGE_CONFIG_ID  = 'config';

const GH_OWNER          = 'PavanTibil';
const GH_REPO           = 'New-Relic';
const GH_WORKFLOW_INFRA = 'project-actions.yml';

// ─── ACTION STATE MACHINE ─────────────────────────────────────────────────────
const INFRA_STATES = {
  IDLE: 'idle', DISPATCHING: 'dispatching', RUNNING: 'running',
  SUCCEEDED: 'succeeded', FAILED: 'failed', TIMEOUT: 'timeout',
};

const ALLOWED_ACTIONS = {
  provisioned: ['stop', 'terminate'],
  stopped:     ['start', 'terminate'],
  terminated:  ['apply'],
};

const NEXT_LIFECYCLE = {
  apply: 'provisioned', start: 'provisioned', stop: 'stopped', terminate: 'terminated',
};

// ─── HOOK: check GitHub repo for .tf files under projects/<dirName>/modules/ ──
// Always runs when projectDirName + token are available — no longer gated on expand.
const useGithubTfFiles = (projectDirName, token) => {
  const [state, setState] = React.useState({ loading: false, hasTf: null });

  React.useEffect(() => {
    // No directory configured → definitely no infra
    if (!projectDirName) {
      setState({ loading: false, hasTf: false });
      return;
    }
    // Token not yet set → can't check; leave hasTf as null (unknown)
    if (!token) {
      setState({ loading: false, hasTf: null });
      return;
    }

    setState({ loading: true, hasTf: null });
    let cancelled = false;

    const ghHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    const checkDir = async (path, depth = 0) => {
      if (depth > 4) return false;
      const r = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`,
        { headers: ghHeaders }
      );
      if (!r.ok) return false;
      const items = await r.json();
      if (!Array.isArray(items)) return false;
      for (const item of items) {
        if (item.type === 'file' && item.name.endsWith('.tf')) return true;
        if (item.type === 'dir') { if (await checkDir(item.path, depth + 1)) return true; }
      }
      return false;
    };

    checkDir(`projects/${projectDirName}/modules`)
      .then(hasTf  => { if (!cancelled) setState({ loading: false, hasTf }); })
      .catch(()    => { if (!cancelled) setState({ loading: false, hasTf: false }); });

    return () => { cancelled = true; };
  }, [projectDirName, token]);

  return state;
};

// ─── ICONS ────────────────────────────────────────────────────────────────────
const PowerOffIcon = ({ size = 13, color = 'currentColor', style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" />
  </svg>
);

const SpinnerIcon = ({ size = 12, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
    <path d="M12 2a10 10 0 0 1 10 10" style={{ animation:'ee-spin 0.8s linear infinite', transformOrigin:'center' }} />
    <style>{`@keyframes ee-spin{to{transform:rotate(360deg)}}`}</style>
  </svg>
);

// ─── GITHUB ACTIONS POLLING ───────────────────────────────────────────────────
const pollWorkflowRun = (token, dispatchTime, onStatusChange, onComplete, cancelRef) => {
  let attempts = 0, lockedRunId = null;
  const MAX_ATTEMPTS = 180, FALLBACK_ATTEMPTS = 8, TIME_SLACK_MS = 60 * 1000;
  const headers = { Accept:'application/vnd.github+json', Authorization:`Bearer ${token}`, 'X-GitHub-Api-Version':'2022-11-28' };

  const doFetch = async () => {
    if (cancelRef && cancelRef.cancelled) return;
    attempts += 1;
    if (attempts > MAX_ATTEMPTS) { onComplete('timeout'); return; }
    try {
      if (lockedRunId) {
        const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${lockedRunId}`, { headers });
        if (!r.ok) { scheduleNext(); return; }
        handleRun(await r.json()); return;
      }
      const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW_INFRA}/runs?per_page=10&branch=main`, { headers });
      if (!res.ok) { scheduleNext(); return; }
      const runs = (await res.json()).workflow_runs || [];
      const cutoff = dispatchTime - TIME_SLACK_MS;
      const candidates = runs.filter(r => new Date(r.created_at).getTime() >= cutoff);
      let run = candidates.length > 0 ? candidates[0] : null;
      if (!run && attempts >= FALLBACK_ATTEMPTS) { run = runs[0] || null; if (run) console.warn('[Eagle Eye] Falling back to newest run:', run.id); }
      if (!run) { scheduleNext(); return; }
      lockedRunId = run.id;
      handleRun(run);
    } catch (err) { console.warn('[Eagle Eye] Poll error:', err); scheduleNext(); }
  };

  const handleRun = (run) => {
    if (cancelRef && cancelRef.cancelled) return;
    if (run.status === 'queued' || run.status === 'in_progress') { onStatusChange(INFRA_STATES.RUNNING, run); scheduleNext(); return; }
    if (run.status === 'completed') { onComplete(run.conclusion === 'success' ? 'success' : run.conclusion || 'failure', run); return; }
    scheduleNext();
  };

  const scheduleNext = () => { if (cancelRef && cancelRef.cancelled) return; setTimeout(doFetch, 8000); };
  setTimeout(doFetch, 6000);
};

// ─── GITHUB DISPATCH ─────────────────────────────────────────────────────────
const callInfraAPI = async (project, action, token) => {
  if (!token || token === '') throw new Error('GitHub ACCESS_TOKEN not configured. Click the ⚙ Config button to set it.');
  if (!project.projectDirName) throw new Error('No project directory name configured for this project.');
  const projectPath = `projects/${project.projectDirName}`;
  console.log(`[Eagle Eye] dispatch: ${action.toUpperCase()} for "${project.name}" → ${projectPath}`);
  const res = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW_INFRA}/dispatches`,
    {
      method: 'POST',
      headers: { 'Content-Type':'application/json', Accept:'application/vnd.github+json', Authorization:`Bearer ${token}`, 'X-GitHub-Api-Version':'2022-11-28' },
      body: JSON.stringify({ ref: 'main', inputs: { project: projectPath, action } }),
    }
  );
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`GitHub Actions dispatch failed (${res.status}): ${body}`); }
  return { success: true };
};

// ─── DEFAULT PROVIDERS ────────────────────────────────────────────────────────
const DEFAULT_CLOUD_PROVIDERS = [
  {
    id: 'gcp', name: 'GCP', label: 'Google Cloud Platform', icon: '☁',
    projects: [
      { name: 'Starapp UAT',  gcpProjectId: 'starapp-backend-uat',  dashboardGuid: 'Nzc4MjQ3OXxWSVp8REFTSEJPQVJEfGRhOjEyMjA0ODcw', dashboardLink: 'https://onenr.io/08jqLng1lRl', knownServices: ['keycloak1','starapp-bot-ms','starapp-notification-ms','starapp-registry-ms','starapp-user-ms','starapp-workflow-ms'], resources: [{ label:'Cloud Run', type:'gcp_cloudrun', alwaysOn:false, scalesToZero:true },{ label:'Cloud SQL', type:'gcp_cloudsql', alwaysOn:true }] },
      { name: 'Starapp PROD', gcpProjectId: 'starapp-backend-prod', dashboardGuid: 'Nzc4MjQ3OXxWSVp8REFTSEJPQVJEfGRhOjEyMjA0ODcx', dashboardLink: 'https://onenr.io/0gR7dDb5pjo', knownServices: ['keycloak1','starapp-registry-ms'], resources: [{ label:'Cloud Run', type:'gcp_cloudrun', alwaysOn:false, scalesToZero:true },{ label:'Cloud SQL', type:'gcp_cloudsql', alwaysOn:true }] },
      { name: 'Pulse Dev',    gcpProjectId: 'pulse-dev-477810',     dashboardGuid: 'Nzc4MjQ3OXxWSVp8REFTSEJPQVJEfGRhOjEyMjA0OTIw', dashboardLink: 'https://onenr.io/08woM1gEWjx', resources: [{ label:'BigQuery', type:'gcp_bigquery', alwaysOn:false }] },
      { name: 'Pulse PROD',   gcpProjectId: null, dashboardGuid: 'Nzc4MjQ3OXxWSVp8REFTSEJPQVJEfGRhOjEyMjA0OTIx', dashboardLink: 'https://onenr.io/0dQen6OvZwe', empty: true, resources: [] },
      { name: 'Mqpro v2',     gcpProjectId: null, dashboardGuid: 'Nzc4MjQ3OXxWSVp8REFTSEJPQVJEfGRhOjEyMjA1MjQ4', dashboardLink: 'https://onenr.io/0qQa13xxBQ1', deleted: true, resources: [] },
      { name: 'GCP Billing',  gcpProjectId: null, dashboardGuid: null, dashboardLink: null, billingOnly: true, billingNotConfigured: true, resources: [{ label:'Total Cost (INR)', type:'gcp_billing', alwaysOn:false }] },
    ],
  },
  {
    id: 'aws', name: 'AWS', label: 'Amazon Web Services', icon: '⚡',
    projects: [
      { name: 'DMS Monitoring', gcpProjectId: null, dashboardGuid: 'Nzc4MjQ3OXxWSVp8REFTSEJPQVJEfGRhOjEyMjAyMDE1', dashboardLink: 'https://onenr.io/0vjAdX8MnRP', resources: [{ label:'App Runner', type:'aws_apprunner', alwaysOn:true },{ label:'RDS', type:'aws_rds', alwaysOn:true },{ label:'CloudFront', type:'aws_cloudfront', alwaysOn:true },{ label:'EC2', type:'aws_ec2', alwaysOn:true }] },
      { name: 'AWS Billing',    gcpProjectId: null, dashboardGuid: 'Nzc4MjQ3OXxWSVp8REFTSEJPQVJEfGRhOjEyMTg1NjI5', dashboardLink: 'https://onenr.io/0Vwg7Wz8ZwJ', billingOnly: true, resources: [{ label:'Total Cost (INR)', type:'aws_billing', alwaysOn:false }] },
    ],
  },
];

const RESOURCE_OPTIONS = {
  gcp: [
    { type:'gcp_cloudrun', label:'Cloud Run', desc:'Serverless containers — scales to zero when idle', alwaysOn:false, scalesToZero:true },
    { type:'gcp_cloudsql', label:'Cloud SQL', desc:'Managed relational databases (MySQL, PostgreSQL)', alwaysOn:true },
    { type:'gcp_bigquery', label:'BigQuery',  desc:'Serverless data warehouse & analytics engine', alwaysOn:false },
  ],
  aws: [
    { type:'aws_apprunner',  label:'App Runner', desc:'Managed containers & web apps — auto-scales to zero', alwaysOn:true },
    { type:'aws_rds',        label:'RDS',        desc:'Managed relational databases (MySQL, PostgreSQL, Aurora)', alwaysOn:true },
    { type:'aws_cloudfront', label:'CloudFront', desc:'Global CDN & content delivery network', alwaysOn:true },
    { type:'aws_ec2',        label:'EC2',        desc:'Virtual machines — tracks CPU utilisation & status checks', alwaysOn:true },
  ],
};

// ─── CONFIG MODAL ─────────────────────────────────────────────────────────────
const ConfigModal = ({ currentToken, onSave, onClose }) => {
  const [tokenInput, setTokenInput] = useState(currentToken || '');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [saved,  setSaved]  = useState(false);
  const [show,   setShow]   = useState(false);

  const handleSave = async () => {
    if (!tokenInput.trim()) { setError('Token cannot be empty.'); return; }
    setSaving(true); setError('');
    try { await onSave(tokenInput.trim()); setSaved(true); setTimeout(() => onClose(), 800); }
    catch (e) { setError(e?.message || 'Save failed.'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(8,11,20,0.92)', backdropFilter:'blur(10px)', zIndex:10000, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'#0f1629', border:'1px solid rgba(255,255,255,0.15)', borderRadius:16, width:'90%', maxWidth:420, padding:'28px 28px 22px', boxShadow:'0 32px 100px rgba(0,0,0,0.8)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
          <div style={{ width:38, height:38, borderRadius:10, background:'rgba(66,133,244,0.12)', border:'1px solid rgba(66,133,244,0.35)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>⚙</div>
          <div>
            <div style={{ fontSize:16, fontWeight:800, color:'#f0f4ff' }}>Configure GitHub Token</div>
            <div style={{ fontSize:11, color:'#7a8aaa', marginTop:1 }}>Stored securely in NerdStorage</div>
          </div>
        </div>
        <div style={{ marginBottom:16 }}>
          <label style={{ fontSize:11, fontWeight:600, color:'#7a8aaa', textTransform:'uppercase', letterSpacing:1, display:'block', marginBottom:6 }}>ACCESS_TOKEN value</label>
          <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
            <input
              type={show ? 'text' : 'password'} value={tokenInput} onChange={e => setTokenInput(e.target.value)}
              placeholder="github_pat_XXXX…"
              style={{ width:'100%', background:'#0d1525', border:'1px solid rgba(255,255,255,0.18)', borderRadius:8, padding:'9px 40px 9px 12px', color:'#f0f4ff', fontSize:13, outline:'none', boxSizing:'border-box', fontFamily:'monospace', colorScheme:'dark' }}
            />
            <button onClick={() => setShow(s => !s)} style={{ position:'absolute', right:10, background:'none', border:'none', cursor:'pointer', color:'#7a8aaa', fontSize:13, padding:0, outline:'none' }}>{show ? '🙈' : '👁'}</button>
          </div>
          {tokenInput && (
            <div style={{ marginTop:5, fontSize:10, color:'#4a6080' }}>
              {tokenInput.startsWith('github_pat_') || tokenInput.startsWith('ghp_')
                ? <span style={{ color:'#00d4aa' }}>✓ Looks like a valid GitHub token</span>
                : <span style={{ color:'#f5a623' }}>⚠ Expected: starts with github_pat_ or ghp_</span>}
            </div>
          )}
        </div>
        {error && <div style={{ fontSize:12, color:'#ff4d6d', marginBottom:14, padding:'8px 12px', background:'rgba(255,77,109,0.08)', borderRadius:6, border:'1px solid rgba(255,77,109,0.2)' }}>⚠ {error}</div>}
        {saved  && <div style={{ fontSize:12, color:'#00d4aa', marginBottom:14, padding:'8px 12px', background:'rgba(0,212,170,0.08)', borderRadius:6, border:'1px solid rgba(0,212,170,0.2)' }}>✓ Token saved!</div>}
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={{ padding:'8px 18px', borderRadius:8, border:'1px solid rgba(255,255,255,0.15)', background:'transparent', color:'#7a8aaa', fontWeight:600, fontSize:13, cursor:'pointer', outline:'none', boxShadow:'none', WebkitAppearance:'none', appearance:'none' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding:'8px 22px', borderRadius:8, border:'none', background:'#4285f4', color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer', outline:'none', opacity:saving ? 0.65 : 1 }}>{saving ? 'Saving…' : 'Save Token'}</button>
        </div>
      </div>
    </div>
  );
};

// ─── INFRA STATUS BANNER ──────────────────────────────────────────────────────
const InfraStatusBanner = ({ actionState, lastAction, onDismiss }) => {
  if (actionState === INFRA_STATES.IDLE) return null;
  const actionLabel = { apply:'Apply', stop:'Stop', start:'Start', terminate:'Terminate' }[lastAction] || lastAction;
  const configs = {
    [INFRA_STATES.DISPATCHING]: { color:'#4285f4', bg:'rgba(66,133,244,0.10)', border:'rgba(66,133,244,0.3)', icon:<SpinnerIcon size={13} color="#4285f4" />, text:`Dispatching ${actionLabel}…`, sub:'Sending workflow_dispatch to GitHub Actions' },
    [INFRA_STATES.RUNNING]:     { color:'#f5a623', bg:'rgba(245,166,35,0.10)', border:'rgba(245,166,35,0.3)', icon:<SpinnerIcon size={13} color="#f5a623" />, text:`${actionLabel} running…`, sub:'GitHub Actions workflow is in progress' },
    [INFRA_STATES.SUCCEEDED]:   { color:'#00d4aa', bg:'rgba(0,212,170,0.10)',  border:'rgba(0,212,170,0.3)',  icon:'✓', text:`${actionLabel} completed`, sub:'Workflow finished successfully', dismissable:true },
    [INFRA_STATES.FAILED]:      { color:'#ff4d6d', bg:'rgba(255,77,109,0.10)', border:'rgba(255,77,109,0.3)', icon:'✗', text:`${actionLabel} failed`, sub:'Check GitHub Actions for details', dismissable:true },
    [INFRA_STATES.TIMEOUT]:     { color:'#f5a623', bg:'rgba(245,166,35,0.10)', border:'rgba(245,166,35,0.3)', icon:'⚠', text:`${actionLabel} timed out`, sub:'Check GitHub Actions manually', dismissable:true },
  };
  const cfg = configs[actionState]; if (!cfg) return null;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:8, margin:'4px 0 6px' }}>
      <span style={{ color:cfg.color, fontSize:13, flexShrink:0, display:'flex', alignItems:'center' }}>{cfg.icon}</span>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:12, fontWeight:700, color:cfg.color }}>{cfg.text}</div>
        <div style={{ fontSize:10, color:'#7a8aaa', marginTop:1 }}>{cfg.sub}</div>
      </div>
      {cfg.dismissable && <button onClick={onDismiss} style={{ background:'none', border:'none', outline:'none', boxShadow:'none', color:'#4a6080', cursor:'pointer', fontSize:14, padding:'0 2px', lineHeight:1 }}>✕</button>}
    </div>
  );
};

// ─── INFRA CONFIRMATION MODAL ─────────────────────────────────────────────────
const InfraConfirmModal = ({ project, action, ghToken, onConfirm, onCancel }) => {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const isStop = action === 'stop', isStart = action === 'start', isApply = action === 'apply', isTerminate = action === 'terminate';

  const handleConfirm = async () => {
    setBusy(true); setErr('');
    try {
      const ghAction = isApply ? 'apply' : isStop ? 'stop' : isStart ? 'start' : 'destroy';
      const preDispatch = Date.now();
      await callInfraAPI(project, ghAction, ghToken);
      onConfirm(preDispatch);
    } catch (e) { setErr(e?.message || 'GitHub Actions dispatch failed.'); setBusy(false); }
  };

  const colors = isApply ? { bg:'rgba(66,133,244,0.12)', border:'rgba(66,133,244,0.4)', text:'#4285f4' }
    : isTerminate ? { bg:'rgba(255,77,109,0.12)', border:'rgba(255,77,109,0.4)', text:'#ff4d6d' }
    : isStart     ? { bg:'rgba(0,212,170,0.12)',  border:'rgba(0,212,170,0.4)',  text:'#00d4aa' }
    :               { bg:'rgba(245,166,35,0.12)', border:'rgba(245,166,35,0.4)', text:'#f5a623' };

  const title   = isApply ? 'Apply Infrastructure?' : isTerminate ? 'Terminate Infrastructure?' : isStart ? 'Start Infrastructure?' : 'Stop Infrastructure?';
  const btnText = busy ? 'Dispatching…' : isApply ? 'Yes, apply it' : isTerminate ? 'Yes, terminate' : isStart ? 'Yes, start it' : 'Yes, stop it';
  const projectPath = `projects/${project.projectDirName}`;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(8,11,20,0.92)', backdropFilter:'blur(10px)', zIndex:10000, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onCancel}>
      <div style={{ background:'#0f1629', border:`1px solid ${colors.border}`, borderRadius:16, width:'90%', maxWidth:440, padding:'28px 28px 22px', boxShadow:'0 32px 100px rgba(0,0,0,0.8)' }} onClick={e => e.stopPropagation()}>
        <div style={{ width:48, height:48, borderRadius:12, background:colors.bg, border:`1px solid ${colors.border}`, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:16 }}>
          {isTerminate ? <PowerOffIcon size={22} color={colors.text} /> : <span style={{ fontSize:22 }}>{isApply ? '⚙' : isStart ? '▶' : '⏸'}</span>}
        </div>
        <div style={{ fontSize:17, fontWeight:800, color:'#f0f4ff', marginBottom:8 }}>{title}</div>
        <div style={{ fontSize:13, color:'#7a8aaa', lineHeight:1.6, marginBottom:20 }}>
          {isApply && <>Run <span style={{ fontFamily:'monospace', color:colors.text, fontWeight:700 }}>terraform apply</span> on <strong style={{ color:'#f0f4ff' }}>{project.name}</strong>. Resources will be <strong style={{ color:colors.text }}>provisioned or updated</strong>.</>}
          {isStop  && <>Scale down all services for <strong style={{ color:'#f0f4ff' }}>{project.name}</strong> via <span style={{ fontFamily:'monospace', color:colors.text }}>gcloud / aws CLI</span>.</>}
          {isStart && <>Scale up all services for <strong style={{ color:'#f0f4ff' }}>{project.name}</strong> via <span style={{ fontFamily:'monospace', color:colors.text }}>gcloud / aws CLI</span>.</>}
          {isTerminate && <><span style={{ fontFamily:'monospace', color:colors.text, fontWeight:700 }}>terraform destroy</span> on <strong style={{ color:'#f0f4ff' }}>{project.name}</strong>. All resources will be <strong style={{ color:colors.text }}>permanently destroyed</strong>.<div style={{ marginTop:10, padding:'8px 12px', background:'rgba(255,77,109,0.07)', border:'1px solid rgba(255,77,109,0.2)', borderRadius:8, fontSize:12, color:'#ff4d6d' }}>⚠ Use Apply to re-provision after termination.</div></>}
        </div>
        <div style={{ fontSize:12, color:'#4a6080', marginBottom:14, padding:'8px 12px', background:'rgba(255,255,255,0.03)', borderRadius:6, border:'1px solid rgba(255,255,255,0.07)' }}>
          🔗 <strong style={{ color:'#c8d4f0' }}>{GH_OWNER}/{GH_REPO}</strong>
          <div style={{ marginTop:3, fontSize:11, color:'#3d5070' }}>Path: <code style={{ color:'#7a9aaa' }}>{projectPath}</code></div>
        </div>
        {!ghToken && <div style={{ fontSize:12, color:'#f5a623', marginBottom:14, padding:'8px 12px', background:'rgba(245,166,35,0.08)', borderRadius:6, border:'1px solid rgba(245,166,35,0.25)' }}>⚠ ACCESS_TOKEN not set — use ⚙ Config to add it first.</div>}
        {err      && <div style={{ fontSize:12, color:'#ff4d6d', marginBottom:14, padding:'8px 12px', background:'rgba(255,77,109,0.08)', borderRadius:6, border:'1px solid rgba(255,77,109,0.2)' }}>⚠ {err}</div>}
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button onClick={onCancel} disabled={busy} style={{ padding:'8px 18px', borderRadius:8, border:'1px solid rgba(255,255,255,0.15)', background:'transparent', color:'#7a8aaa', fontWeight:600, fontSize:13, cursor:'pointer', outline:'none', boxShadow:'none', WebkitAppearance:'none', appearance:'none' }}>Cancel</button>
          <button onClick={handleConfirm} disabled={busy || !ghToken} style={{ padding:'8px 20px', borderRadius:8, border:'none', background:colors.text, color:'#fff', fontWeight:700, fontSize:13, cursor:busy||!ghToken?'not-allowed':'pointer', outline:'none', opacity:busy||!ghToken?0.5:1 }}>{btnText}</button>
        </div>
      </div>
    </div>
  );
};

// ─── PROJECT DOTS DROPDOWN ────────────────────────────────────────────────────
const ProjectDotsDropdown = ({ project, onAction, disabledActions = [], activeAction = null, infraReason = '' }) => {
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState({ top:0, left:0 });
  const btnRef = useRef(null), rafRef = useRef(null);

  const updatePos = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const w = 260; let left = r.right - w;
    if (left < 8) left = r.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    setPos({ top: r.bottom + 6, left });
  };
  const startTracking = () => { const tick = () => { updatePos(); rafRef.current = requestAnimationFrame(tick); }; rafRef.current = requestAnimationFrame(tick); };
  const stopTracking  = () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };
  const handleOpen = (e) => { e.stopPropagation(); if (open) { setOpen(false); stopTracking(); return; } updatePos(); setOpen(true); startTracking(); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (btnRef.current && !btnRef.current.contains(e.target)) { setOpen(false); stopTracking(); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => () => stopTracking(), []);

  const isBusy = activeAction !== null;
  // All 4 actions disabled = no infra available
  const allDisabled = ['apply','stop','start','terminate'].every(a => disabledActions.includes(a));

  const menuBtn = (onClick, color, label, desc, disabled, icon) => {
    const isRunning = isBusy && activeAction === label.toLowerCase();
    const actualDisabled = disabled || isBusy;
    // Determine tooltip text for disabled state
    const disabledReason = allDisabled && infraReason
      ? infraReason
      : isBusy ? `Locked — ${activeAction} in progress` : desc;
    return (
      <button onClick={onClick} disabled={actualDisabled}
        style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'10px 14px', background:'transparent', border:'none', cursor:actualDisabled?'not-allowed':'pointer', textAlign:'left', outline:'none', opacity:actualDisabled?0.35:1 }}
        onMouseEnter={e => { if (!actualDisabled) e.currentTarget.style.background=`${color}18`; }}
        onMouseLeave={e => { e.currentTarget.style.background='transparent'; }}>
        {isRunning
          ? <span style={{ width:16, height:16, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><SpinnerIcon size={12} color={color} /></span>
          : icon
          ? <span style={{ width:16, height:16, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{icon}</span>
          : <span style={{ width:8, height:8, borderRadius:'50%', background:actualDisabled?'#8899aa':color, flexShrink:0 }} />}
        <div style={{ flex:1 }}>
          <div style={{ fontSize:12, fontWeight:700, color:actualDisabled?'#6a7a8a':color }}>{label}</div>
          <div style={{ fontSize:10, color:'#5a6888', marginTop:1 }}>{isRunning ? 'Running on GitHub Actions…' : actualDisabled ? disabledReason : desc}</div>
        </div>
        {isRunning && <span style={{ fontSize:10, color, fontWeight:700 }}>●</span>}
      </button>
    );
  };

  const dropdown = open ? ReactDOM.createPortal(
    <div style={{ position:'fixed', top:pos.top, left:pos.left, zIndex:99999, background:'#0f1629', border:'1px solid rgba(255,255,255,0.13)', borderRadius:10, boxShadow:'0 12px 40px rgba(0,0,0,0.75)', width:260, overflow:'hidden', animation:'eeDropIn 0.12s ease' }}>
      <style>{`@keyframes eeDropIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{ padding:'8px 14px 6px', borderBottom:'1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ fontSize:11, fontWeight:700, color:'#c8d4f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{project.name}</div>
        {project.projectDirName && <div style={{ fontSize:10, color:'#3d5070', marginTop:1, fontFamily:'monospace' }}>projects/{project.projectDirName}</div>}
        <div style={{ fontSize:10, color:'#4a6080', marginTop:1 }}>Infrastructure actions → GitHub Actions</div>
        {allDisabled && infraReason && (
          <div style={{ marginTop:5, display:'flex', alignItems:'center', gap:5, fontSize:10, color:'#7a8aaa', background:'rgba(122,138,170,0.08)', border:'1px solid rgba(122,138,170,0.2)', borderRadius:5, padding:'4px 8px' }}>
            <span style={{ fontSize:12 }}>📂</span>
            <span>{infraReason}</span>
          </div>
        )}
        {isBusy && !allDisabled && <div style={{ marginTop:4, display:'flex', alignItems:'center', gap:5, fontSize:10, color:'#f5a623' }}><SpinnerIcon size={10} color="#f5a623" /><span>Action in progress — buttons locked</span></div>}
      </div>
      {menuBtn((e) => { e.stopPropagation(); setOpen(false); stopTracking(); onAction(project, 'apply');     }, '#4285f4', 'Apply',     'Deploy / update infrastructure',            disabledActions.includes('apply'))}
      {menuBtn((e) => { e.stopPropagation(); setOpen(false); stopTracking(); onAction(project, 'stop');      }, '#f5a623', 'Stop',      'Pause all services via CLI',                disabledActions.includes('stop'))}
      {menuBtn((e) => { e.stopPropagation(); setOpen(false); stopTracking(); onAction(project, 'start');     }, '#00d4aa', 'Start',     'Resume all services via CLI',               disabledActions.includes('start'))}
      {menuBtn((e) => { e.stopPropagation(); setOpen(false); stopTracking(); onAction(project, 'terminate'); }, '#ff4d6d', 'Terminate', 'Destroy all resources (terraform destroy)',  disabledActions.includes('terminate'), <PowerOffIcon size={13} color="#ff4d6d" />)}
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button ref={btnRef} onClick={handleOpen} title="Infrastructure actions"
        style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:3, width:26, height:26, borderRadius:7, flexShrink:0, border:'none', outline:'none', boxShadow:'none', background:open?'rgba(255,255,255,0.08)':'transparent', cursor:'pointer', padding:0, transition:'background 0.15s', position:'relative' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background='rgba(255,255,255,0.08)'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background='transparent'; }}>
        {isBusy && <span style={{ position:'absolute', top:-2, right:-2, width:7, height:7, borderRadius:'50%', background:'#f5a623', border:'1.5px solid #0f1629', animation:'eePulse 1s ease-in-out infinite' }} />}
        <style>{`@keyframes eePulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
        <span style={{ width:3, height:3, borderRadius:'50%', background:'#7a8aaa', flexShrink:0 }} />
        <span style={{ width:3, height:3, borderRadius:'50%', background:'#7a8aaa', flexShrink:0 }} />
        <span style={{ width:3, height:3, borderRadius:'50%', background:'#7a8aaa', flexShrink:0 }} />
      </button>
      {dropdown}
    </>
  );
};

// ─── RESOURCE QUERY HELPERS ───────────────────────────────────────────────────
const buildResourceQuery = (resource, gcpProjectId) => {
  const gcpFilter = gcpProjectId ? `WHERE projectId = '${gcpProjectId}'` : '';
  switch (resource.type) {
    case 'gcp_cloudrun':    return `SELECT sum(container.BillableInstanceTime) AS billableTime, count(*) AS samples FROM GcpRunRevisionSample ${gcpFilter} SINCE 5 minutes ago`;
    case 'gcp_cloudsql':    return `SELECT count(*) AS samples FROM GcpCloudSqlSample ${gcpFilter} SINCE 30 minutes ago`;
    case 'gcp_bigquery':    return `SELECT count(*) AS samples FROM GcpBigQueryDataSetSample ${gcpFilter} SINCE 30 minutes ago`;
    case 'gcp_billing':     return `SELECT count(*) AS samples FROM Metric SINCE 1 hour ago LIMIT 1`;
    case 'aws_apprunner':   return `SELECT max(\`aws.apprunner.ActiveInstances\`) AS activeInstances, count(*) AS samples FROM Metric WHERE aws.Namespace = 'AWS/AppRunner' SINCE 5 minutes ago`;
    case 'aws_rds':         return `SELECT average(\`aws.rds.FreeableMemory\`) AS freeMemory, average(\`aws.rds.WriteLatency\`) AS writeLatency, count(*) AS samples FROM Metric WHERE aws.Namespace = 'AWS/RDS' SINCE 5 minutes ago`;
    case 'aws_cloudfront':  return `SELECT count(*) AS samples, average(\`aws.cloudfront.5xxErrorRate\`) AS errorRate5xx, average(\`aws.cloudfront.TotalErrorRate\`) AS totalErrorRate FROM Metric WHERE aws.Namespace = 'AWS/CloudFront' SINCE 24 hours ago`;
    case 'aws_ec2':         return `SELECT max(\`aws.ec2.StatusCheckFailed\`) AS statusCheckFailed, max(\`aws.ec2.StatusCheckFailed_Instance\`) AS instanceCheckFailed, average(\`aws.ec2.CPUUtilization\`) AS cpuUsage, count(*) AS samples FROM Metric WHERE aws.Namespace = 'AWS/EC2' SINCE 5 minutes ago`;
    case 'aws_ec2_managed': return `SELECT max(\`aws.ec2.StatusCheckFailed\`) AS statusCheckFailed, average(\`aws.ec2.CPUUtilization\`) AS cpuUsage, count(*) AS samples FROM Metric WHERE aws.Namespace = 'AWS/EC2' AND \`aws.ec2.tag.ManagedBy\` = 'eagle-eye' SINCE 5 minutes ago`;
    case 'aws_billing':     return `SELECT max(\`aws.billing.EstimatedCharges\`) * 92 AS totalCostINR, count(*) AS samples FROM Metric WHERE aws.Namespace = 'AWS/Billing' SINCE this month`;
    default:                return `SELECT count(*) AS samples FROM Metric WHERE entity.name = '${resource.label}' SINCE 5 minutes ago`;
  }
};

const noData = (resource) => resource.scalesToZero ? 'green' : resource.alwaysOn ? 'yellow' : 'unknown';

const deriveResourceStatus = (resource, row) => {
  if (!row) return noData(resource);
  const type = resource.type === 'aws_ec2_managed' ? 'aws_ec2' : resource.type;
  switch (type) {
    case 'gcp_cloudrun': case 'gcp_cloudsql': { return (row.samples ?? 0) === 0 ? noData(resource) : 'green'; }
    case 'gcp_bigquery': { return (row.samples ?? 0) === 0 ? 'unknown' : 'green'; }
    case 'gcp_billing':  return 'unknown';
    case 'aws_apprunner': {
      if ((row.samples ?? 0) === 0) return 'yellow';
      const active = row.activeInstances ?? null;
      return active !== null && active === 0 ? 'yellow' : 'green';
    }
    case 'aws_rds': {
      if ((row.samples ?? 0) === 0) return 'yellow';
      const fm = row.freeMemory ?? null, wl = row.writeLatency ?? null;
      if (fm !== null && fm < 50*1024*1024)  return 'red';
      if (fm !== null && fm < 200*1024*1024) return 'yellow';
      if (wl !== null && wl > 1)             return 'yellow';
      return 'green';
    }
    case 'aws_cloudfront': {
      if ((row.samples ?? 0) === 0) return 'yellow';
      const e5 = row.errorRate5xx ?? null, ea = row.totalErrorRate ?? null;
      if (e5 !== null && e5 > 5)  return 'red';
      if (e5 !== null && e5 > 2)  return 'yellow';
      if (ea !== null && ea > 25) return 'red';
      if (ea !== null && ea > 15) return 'yellow';
      return 'green';
    }
    case 'aws_ec2': {
      if ((row.samples ?? 0) === 0) return 'yellow';
      const sf = typeof row.statusCheckFailed === 'number' ? row.statusCheckFailed : 0;
      const if_ = typeof row.instanceCheckFailed === 'number' ? row.instanceCheckFailed : 0;
      const cpu = typeof row.cpuUsage === 'number' ? row.cpuUsage : null;
      if (sf > 0 || if_ > 0) return 'red';
      if (cpu !== null && cpu > 90) return 'red';
      if (cpu !== null && cpu > 75) return 'yellow';
      return 'green';
    }
    case 'aws_billing': return (row.samples ?? 0) === 0 ? 'unknown' : 'green';
    default: return (row.samples ?? 0) === 0 ? noData(resource) : 'green';
  }
};

const deriveResourceReason = (resource, row, status) => {
  if (status === 'green' || status === 'unknown' || !row) return null;
  const type = resource.type === 'aws_ec2_managed' ? 'aws_ec2' : resource.type;
  switch (type) {
    case 'gcp_cloudsql': return 'No metric samples received — DB may be stopped or unreachable';
    case 'aws_apprunner': {
      const active = row.activeInstances ?? null, s = row.samples ?? 0;
      if (s === 0) return 'No metrics in last 5 min — services may be stopped';
      if (active !== null && active === 0) return 'All App Runner services are paused (0 active instances)';
      return 'App Runner services may be paused or starting up';
    }
    case 'aws_rds': {
      if ((row.samples ?? 0) === 0) return 'No metrics in last 5 min — RDS instance may be stopped';
      const fm = row.freeMemory ?? null, wl = row.writeLatency ?? null, parts = [];
      if (fm !== null && fm < 50*1024*1024)       parts.push(`Critical: only ${(fm/1024/1024).toFixed(0)} MB memory free`);
      else if (fm !== null && fm < 200*1024*1024) parts.push(`Low memory: ${(fm/1024/1024).toFixed(0)} MB free`);
      if (wl !== null && wl > 1)                  parts.push(`High write latency: ${(wl*1000).toFixed(0)} ms`);
      return parts.join(' · ') || null;
    }
    case 'aws_cloudfront': {
      const e5 = row.errorRate5xx ?? null, ea = row.totalErrorRate ?? null, s = row.samples ?? 0;
      if (s === 0) return 'No metric samples received from CloudFront namespace';
      const parts = [];
      if (e5 !== null && e5 > 2)  parts.push(`5xx error rate: ${e5.toFixed(1)}%${e5 > 5 ? ' (critical)' : ''}`);
      if (ea !== null && ea > 15) parts.push(`Total error rate: ${ea.toFixed(1)}% (incl. 4xx)`);
      return parts.join(' · ') || null;
    }
    case 'aws_ec2': {
      const sf = typeof row.statusCheckFailed === 'number' ? row.statusCheckFailed : 0;
      const if_ = typeof row.instanceCheckFailed === 'number' ? row.instanceCheckFailed : 0;
      const cpu = typeof row.cpuUsage === 'number' ? row.cpuUsage : null, s = row.samples ?? 0;
      if (s === 0) return 'No metric samples in the last 5 minutes';
      const parts = [];
      if (sf > 0)  parts.push('System status check failed');
      if (if_ > 0) parts.push('Instance status check failed');
      if (cpu !== null && cpu > 75) parts.push(`CPU usage: ${cpu.toFixed(1)}%${cpu > 90 ? ' (critical)' : ''}`);
      return parts.join(' · ') || null;
    }
    case 'gcp_cloudrun': return status === 'yellow' ? 'No billable instance time — all revisions may be scaled to zero' : null;
    case 'gcp_bigquery': return status === 'yellow' ? 'No dataset samples — BigQuery may be idle or not yet active' : null;
    default: return null;
  }
};

const worstStatus = (statuses) => {
  if (statuses.some(s => s === 'red'))    return 'red';
  if (statuses.some(s => s === 'yellow')) return 'yellow';
  if (statuses.some(s => s === 'green'))  return 'green';
  return 'unknown';
};

const STATUS_META = {
  green:   { label:'Healthy',      color:'#00d4aa' },
  yellow:  { label:'Warning',      color:'#f5a623' },
  red:     { label:'Critical',     color:'#ff4d6d' },
  unknown: { label:'No Data',      color:'#7a8aaa' },
  deleted: { label:'Deleted',      color:'#4a5568' },
  empty:   { label:'No Resources', color:'#3d4a66' },
};

const PROVIDER_META = {
  gcp: { gradient:'linear-gradient(135deg, rgba(66,133,244,0.18) 0%, rgba(52,168,83,0.10) 100%)', accent:'#4285F4' },
  aws: { gradient:'linear-gradient(135deg, rgba(255,153,0,0.18) 0%, rgba(255,90,0,0.10) 100%)',   accent:'#FF9900' },
};

const canBePaused = (t, row) => t === 'aws_apprunner' && row && (row.activeInstances ?? null) === 0 && (row.samples ?? 0) > 0;

const ec2StateDisplay = (state) => {
  const s = (state ?? '').toString().toLowerCase().trim();
  switch (s) {
    case 'running':  return { dot:'green',  label:'✓ Running',  color:'#00d4aa' };
    case 'impaired': return { dot:'red',    label:'✗ Impaired', color:'#ff4d6d' };
    case 'stopped':  return { dot:'yellow', label:'✗ Stopped',  color:'#f5a623' };
    case 'pending':  return { dot:'yellow', label:'◌ Pending',  color:'#f5a623' };
    case 'stopping': return { dot:'yellow', label:'◌ Stopping', color:'#f5a623' };
    default:         return { dot:'grey',   label: s || '— Unknown', color:'#7a8aaa' };
  }
};

const BILLING_BUDGET_INR = 4600;
const billingCostToStatus = (cost) => {
  if (cost === null) return 'unknown';
  const pct = (cost / BILLING_BUDGET_INR) * 100;
  return pct >= 70 ? 'red' : pct >= 50 ? 'yellow' : 'green';
};
const estimatedCostToStatus = (est) => {
  if (est === null) return 'unknown';
  const pct = (est / BILLING_BUDGET_INR) * 100;
  return pct >= 100 ? 'red' : pct >= 85 ? 'yellow' : 'green';
};

const BillingHealthBadge = ({ cost }) => {
  if (cost === null) return <span className="status-badge status-badge--grey"><span className="status-badge__dot" />Billing</span>;
  const pct = (cost / BILLING_BUDGET_INR) * 100, status = billingCostToStatus(cost);
  return (
    <span className={`status-badge status-badge--${status} status-badge--billing`} title={`${pct.toFixed(1)}% of monthly budget`}>
      <span className="status-badge__dot" />
      <span className="status-badge__billing-current">{'₹' + cost.toFixed(0)}</span>
      <span className="status-badge__billing-sep">/</span>
      <span className="status-badge__billing-budget">{'₹' + BILLING_BUDGET_INR + ' budget'}</span>
    </span>
  );
};

const StatusDot = ({ status }) => {
  const cls = (status === 'unknown' || status === 'deleted' || status === 'empty') ? 'grey' : status;
  return <span className={`status-dot status-dot--${cls}`} />;
};

const StatusBadge = ({ status, label }) => {
  const meta = STATUS_META[status] ?? STATUS_META.green;
  const cls  = (status === 'unknown' || status === 'deleted' || status === 'empty') ? 'grey' : status;
  return <span className={`status-badge status-badge--${cls}`}><span className="status-badge__dot" />{label ?? meta.label}</span>;
};

const DashboardIcon = ({ onClick }) => (
  <span onClick={onClick} title="Open Dashboard" style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:26, height:26, borderRadius:6, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(255,255,255,0.05)', cursor:'pointer', flexShrink:0 }}>
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <rect x="1"   y="1"   width="4.5" height="4.5" rx="1" fill="#7a8aaa" opacity="0.9"/>
      <rect x="7.5" y="1"   width="4.5" height="4.5" rx="1" fill="#7a8aaa" opacity="0.6"/>
      <rect x="1"   y="7.5" width="4.5" height="4.5" rx="1" fill="#7a8aaa" opacity="0.6"/>
      <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="1" fill="#7a8aaa" opacity="0.35"/>
    </svg>
  </span>
);

// ─── NO INFRA YET BADGE ───────────────────────────────────────────────────────
// Shows next to project name when no .tf files exist in the repo.
const NoInfraBadge = ({ checking = false }) => {
  if (checking) {
    return (
      <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10, color:'#4a6080', fontWeight:500 }}>
        <SpinnerIcon size={9} color="#4a6080" />
        <span>checking…</span>
      </span>
    );
  }
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: '#7a8aaa',
      background: 'rgba(122,138,170,0.10)',
      border: '1px solid rgba(122,138,170,0.28)',
      borderRadius: 100,
      padding: '2px 9px',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      flexShrink: 0,
    }}>
      No Infra Yet
    </span>
  );
};

// ─── PROJECT MANAGER MODAL ────────────────────────────────────────────────────
const ProjectManagerModal = ({ providers, providerId, projectHealthMap, onSave, onClose }) => {
  const [view,          setView]          = useState('list');
  const [form,          setForm]          = useState({ providerId, name:'', gcpProjectId:'', dashboardGuid:'', dashboardLink:'', projectDirName:'', projectType:'normal', selectedResources:[], knownServices:'', customResources:'' });
  const [editInfo,      setEditInfo]      = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [saveError,     setSaveError]     = useState('');

  const provider    = providers.find(p => p.id === providerId);
  const pi          = providers.findIndex(p => p.id === providerId);
  const accentColor = providerId === 'gcp' ? '#4285f4' : '#FF9900';
  const setField    = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const startEdit = (pj) => {
    const project = provider.projects[pj];
    let projectType = 'normal';
    if (project.deleted) projectType = 'deleted';
    else if (project.empty) projectType = 'empty';
    else if (project.billingNotConfigured || project.billingOnly) projectType = 'billing';
    const knownTypes = new Set((RESOURCE_OPTIONS[providerId] || []).map(o => o.type));
    const customRes  = (project.resources || []).filter(r => !knownTypes.has(r.type)).map(r => r.label).join(', ');
    setForm({ providerId, name:project.name||'', gcpProjectId:project.gcpProjectId||'', dashboardGuid:project.dashboardGuid||'', dashboardLink:project.dashboardLink||'', projectDirName:project.projectDirName||'', projectType, selectedResources:(project.resources||[]).map(r=>r.type).filter(t=>knownTypes.has(t)), knownServices:(project.knownServices||[]).join(', '), customResources:customRes });
    setEditInfo({ pi, pj }); setSaveError(''); setView('form');
  };

  const buildProject = () => {
    const { name, gcpProjectId, dashboardGuid, dashboardLink, projectDirName, projectType, selectedResources, knownServices, customResources } = form;
    const base = { name:name.trim(), gcpProjectId:gcpProjectId.trim()||null, dashboardGuid:dashboardGuid.trim()||null, dashboardLink:dashboardLink.trim()||null, projectDirName:projectDirName.trim()||null };
    if (projectType === 'deleted') return { ...base, deleted:true, resources:[] };
    if (projectType === 'empty')   return { ...base, empty:true, resources:[] };
    if (projectType === 'billing') return { ...base, billingOnly:true, resources:[{ label:'Total Cost (INR)', type:providerId==='aws'?'aws_billing':'gcp_billing', alwaysOn:false }] };
    const allOpts      = RESOURCE_OPTIONS[providerId] || [];
    const stdResources = allOpts.filter(o => selectedResources.includes(o.type)).map(o => ({ ...o }));
    const customParsed = (customResources||'').split(',').map(s=>s.trim()).filter(Boolean).map(label => ({ label, type:'custom_'+label.toLowerCase().replace(/[^a-z0-9]/g,'_'), alwaysOn:false }));
    const resources    = [...stdResources, ...customParsed];
    const project      = { ...base, resources };
    if (selectedResources.includes('gcp_cloudrun') && knownServices.trim())
      project.knownServices = knownServices.split(',').map(s=>s.trim()).filter(Boolean);
    return project;
  };

  const handleSubmit = async () => {
    setSaveError(''); if (!form.name.trim()) { setSaveError('Project name is required.'); return; }
    setSaving(true);
    try {
      const newProviders = providers.map(p => ({ ...p, projects:[...p.projects] }));
      const project = buildProject();
      if (editInfo) newProviders[pi].projects[editInfo.pj] = project;
      await onSave(newProviders); setView('list');
    } catch (e) { setSaveError(e?.message || 'Save failed.'); } finally { setSaving(false); }
  };

  const handleDelete    = async (pj) => { try { const np=providers.map(p=>({...p,projects:[...p.projects]})); np[pi].projects.splice(pj,1); await onSave(np); setDeleteConfirm(null); } catch (e) { setSaveError(e?.message||'Delete failed.'); } };
  const handleArchive   = async (pj) => { try { const np=providers.map(p=>({...p,projects:[...p.projects]})); const proj={...np[pi].projects[pj],deleted:true,resources:[]}; delete proj.billingOnly; delete proj.billingNotConfigured; delete proj.empty; np[pi].projects[pj]=proj; await onSave(np); } catch (e) { setSaveError(e?.message||'Archive failed.'); } };
  const handleUnarchive = async (pj) => { try { const np=providers.map(p=>({...p,projects:[...p.projects]})); const proj={...np[pi].projects[pj]}; delete proj.deleted; np[pi].projects[pj]=proj; await onSave(np); } catch (e) { setSaveError(e?.message||'Unarchive failed.'); } };

  const s = {
    overlay:      { position:'fixed', inset:0, background:'rgba(8,11,20,0.88)', backdropFilter:'blur(10px)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center' },
    panel:        { background:'#0f1629', border:'1px solid rgba(255,255,255,0.12)', borderRadius:20, width:'92%', maxWidth:660, maxHeight:'90vh', overflow:'hidden', display:'flex', flexDirection:'column', boxShadow:'0 32px 100px rgba(0,0,0,0.7)' },
    header:       { padding:'22px 26px 18px', borderBottom:'1px solid rgba(255,255,255,0.08)', display:'flex', alignItems:'flex-start', justifyContent:'space-between' },
    body:         { padding:'22px 26px', overflowY:'auto', flex:1 },
    footer:       { padding:'16px 26px', borderTop:'1px solid rgba(255,255,255,0.08)', display:'flex', gap:10, justifyContent:'flex-end', alignItems:'center' },
    label:        { fontSize:11, fontWeight:600, color:'#7a8aaa', textTransform:'uppercase', letterSpacing:1, marginBottom:6, display:'block' },
    field:        { marginBottom:18 },
    input:        { width:'100%', background:'#0d1525', border:'1px solid rgba(255,255,255,0.18)', borderRadius:8, padding:'9px 12px', color:'#f0f4ff', fontSize:13, outline:'none', boxSizing:'border-box', colorScheme:'dark' },
    btnPrimary:   { padding:'9px 22px', borderRadius:8, border:'none', background:'#4285f4', color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer' },
    btnSecondary: { padding:'9px 18px', borderRadius:8, border:'1px solid rgba(255,255,255,0.15)', background:'transparent', color:'#7a8aaa', fontWeight:600, fontSize:13, cursor:'pointer' },
  };

  if (view === 'list') return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.panel} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
              <span style={{ fontSize:18 }}>{provider?.icon}</span>
              <div style={{ fontSize:19, fontWeight:800, color:accentColor }}>{provider?.name} Projects</div>
            </div>
            <div style={{ fontSize:12, color:'#7a8aaa', marginTop:3 }}>Edit or manage {provider?.label} projects</div>
          </div>
          <button onClick={onClose} style={{ ...s.btnSecondary, padding:'7px 14px', fontSize:12 }}>✕</button>
        </div>
        <div style={s.body}>
          {!provider || provider.projects.length === 0 ? (
            <div style={{ color:'#3d4a66', fontSize:12, fontStyle:'italic', padding:'8px 0' }}>No projects configured yet.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {provider.projects.map((project, pj) => {
                const typeTag  = project.deleted?'Archived':project.empty?'No Monitoring':project.billingNotConfigured?'Billing N/A':project.billingOnly?'Billing':null;
                const key      = `${pi}-${pj}`;
                const tagColor = project.deleted?'#4a5568':project.billingNotConfigured?'#4285f4':'#7a8aaa';
                const tagBg    = project.deleted?'rgba(74,85,104,0.15)':project.billingNotConfigured?'rgba(66,133,244,0.12)':'rgba(255,255,255,0.06)';
                const health   = projectHealthMap?.[project.name] ?? 'unknown';
                const dotColor = project.deleted?'#4a5568':health==='green'?'#00d4aa':health==='yellow'?'#f5a623':health==='red'?'#ff4d6d':'#7a8aaa';
                return (
                  <div key={project.projectDirName || project.name} style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 14px', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10 }}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.055)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,0.03)'}>
                    <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0, background:dotColor }} />
                    <span style={{ flex:1, fontSize:13, fontWeight:600, color:'#c8d4f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{project.name}</span>
                    {project.projectDirName && <span style={{ fontSize:10, color:'#3d5070', fontFamily:'monospace', flexShrink:0 }}>{project.projectDirName}</span>}
                    {typeTag && <span style={{ fontSize:10, fontWeight:700, color:tagColor, background:tagBg, borderRadius:100, padding:'2px 8px', textTransform:'uppercase', letterSpacing:0.5, flexShrink:0, border:`1px solid ${tagColor}44` }}>{typeTag}</span>}
                    {!typeTag && project.resources?.length > 0 && <span style={{ fontSize:11, color:'#4a5568', flexShrink:0 }}>{project.resources.length} resource{project.resources.length!==1?'s':''}</span>}
                    <button onClick={() => startEdit(pj)} style={{ padding:'5px 12px', borderRadius:6, border:'1px solid rgba(200,212,240,0.4)', background:'rgba(200,212,240,0.1)', color:'#c8d4f0', fontWeight:600, fontSize:12, cursor:'pointer', flexShrink:0, outline:'none' }}>Edit</button>
                    {project.deleted
                      ? <button onClick={() => handleUnarchive(pj)} style={{ padding:'5px 12px', borderRadius:6, border:'1px solid rgba(66,133,244,0.55)', background:'rgba(66,133,244,0.12)', color:'#4285f4', fontWeight:600, fontSize:12, cursor:'pointer', flexShrink:0, outline:'none' }}>Unarchive</button>
                      : <button onClick={() => handleArchive(pj)}   style={{ padding:'5px 12px', borderRadius:6, border:'1px solid rgba(245,166,35,0.55)',  background:'rgba(245,166,35,0.12)',  color:'#f5a623', fontWeight:600, fontSize:12, cursor:'pointer', flexShrink:0, outline:'none' }}>Archive</button>}
                    {deleteConfirm === key
                      ? <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span style={{ fontSize:11, color:'#ff4d6d', flexShrink:0 }}>Sure?</span>
                          <button onClick={() => handleDelete(pj)} style={{ padding:'5px 10px', borderRadius:6, border:'1px solid rgba(255,77,109,0.55)', background:'rgba(255,77,109,0.22)', color:'#ff4d6d', fontWeight:700, fontSize:12, cursor:'pointer', outline:'none' }}>Yes</button>
                          <button onClick={() => setDeleteConfirm(null)} style={{ padding:'5px 10px', borderRadius:6, border:'1px solid rgba(255,255,255,0.15)', background:'rgba(255,255,255,0.06)', color:'#7a8aaa', fontWeight:600, fontSize:12, cursor:'pointer', outline:'none' }}>No</button>
                        </div>
                      : <button onClick={() => setDeleteConfirm(key)} style={{ padding:'5px 12px', borderRadius:6, border:'1px solid rgba(255,77,109,0.55)', background:'rgba(255,77,109,0.12)', color:'#ff4d6d', fontWeight:600, fontSize:12, cursor:'pointer', flexShrink:0, outline:'none' }}>Delete</button>}
                  </div>
                );
              })}
            </div>
          )}
          {saveError && <div style={{ fontSize:12, color:'#ff4d6d', marginTop:10, padding:'8px 12px', background:'rgba(255,77,109,0.08)', borderRadius:6, border:'1px solid rgba(255,77,109,0.2)' }}>⚠ {saveError}</div>}
        </div>
      </div>
    </div>
  );

  // ── Edit form ──────────────────────────────────────────────────────────────────
  const providerOptions = RESOURCE_OPTIONS[form.providerId] || [];
  const hasCloudRun     = form.selectedResources.includes('gcp_cloudrun');
  const goBack          = () => setView('list');

  return (
    <div style={s.overlay} onClick={goBack}>
      <div style={s.panel} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <div style={{ fontSize:19, fontWeight:800, color:'#f0f4ff' }}>Edit Project</div>
            <div style={{ fontSize:12, color:'#7a8aaa', marginTop:3 }}>Update the project details below</div>
          </div>
          <button onClick={goBack} style={{ ...s.btnSecondary, padding:'7px 14px', fontSize:12 }}>← Back</button>
        </div>
        <div style={s.body}>
          <div style={{ ...s.field, marginBottom:14 }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 14px', borderRadius:100, border:`1px solid ${accentColor}44`, background:`${accentColor}18`, fontSize:12, fontWeight:700, color:accentColor }}>
              {providerId==='gcp' ? '☁ Google Cloud Platform' : '⚡ Amazon Web Services'}
            </div>
          </div>
          <div style={s.field}>
            <label style={s.label}>Project Type</label>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {[{ value:'normal', title:'Normal', sub:'Monitored resources' },{ value:'empty', title:'No Monitoring', sub:'Dashboard link only' },{ value:'deleted', title:'Archived', sub:'Hidden from main view' },{ value:'billing', title:'Billing Only', sub:'Cost tracking' }].map(opt => {
                const sel = form.projectType === opt.value;
                return (
                  <div key={opt.value} onClick={() => setField('projectType', opt.value)} style={{ padding:'9px 14px', borderRadius:9, cursor:'pointer', border:sel?`1px solid ${accentColor}66`:'1px solid rgba(255,255,255,0.07)', background:sel?`${accentColor}12`:'rgba(255,255,255,0.03)' }}>
                    <div style={{ fontSize:13, fontWeight:700, color:sel?accentColor:'#c8d4f0' }}>{opt.title}</div>
                    <div style={{ fontSize:11, color:'#4a6080', marginTop:2 }}>{opt.sub}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={s.field}>
            <label style={s.label}>Project Name *</label>
            <input value={form.name} onChange={e => setField('name', e.target.value)} placeholder="e.g. Starapp UAT" style={s.input} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Project Dir Name <span style={{ color:'#4a6080', fontWeight:500, textTransform:'none', letterSpacing:0 }}>(folder under projects/ in repo)</span></label>
            <input value={form.projectDirName} onChange={e => setField('projectDirName', e.target.value)} placeholder="e.g. starapp-uat  →  projects/starapp-uat/" style={s.input} />
            <div style={{ marginTop:5, fontSize:11, color:'#4a6080' }}>
              Set this to enable infra buttons. The app will look for <code style={{ color:'#6a8aaa' }}>.tf</code> files under <code style={{ color:'#6a8aaa' }}>projects/&lt;dir&gt;/modules/</code> in the GitHub repo.
            </div>
          </div>
          {form.providerId==='gcp' && form.projectType==='normal' && (
            <div style={s.field}>
              <label style={s.label}>GCP Project ID</label>
              <input value={form.gcpProjectId} onChange={e => setField('gcpProjectId', e.target.value)} placeholder="e.g. my-project-123456" style={s.input} />
            </div>
          )}
          <div style={s.field}>
            <label style={s.label}>Dashboard GUID</label>
            <input value={form.dashboardGuid} onChange={e => setField('dashboardGuid', e.target.value)} placeholder="e.g. Nzc4MjQ3OX..." style={s.input} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Dashboard Short Link</label>
            <input value={form.dashboardLink} onChange={e => setField('dashboardLink', e.target.value)} placeholder="e.g. https://onenr.io/..." style={s.input} />
          </div>
          {form.projectType==='normal' && (
            <div style={s.field}>
              <label style={s.label}>Resources to Monitor</label>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {providerOptions.map(opt => {
                  const checked = form.selectedResources.includes(opt.type);
                  return (
                    <label key={opt.type} style={{ display:'flex', alignItems:'flex-start', gap:10, cursor:'pointer', padding:'10px 12px', background:checked?`rgba(${form.providerId==='gcp'?'66,133,244':'255,153,0'},0.08)`:'rgba(255,255,255,0.03)', borderRadius:8, border:checked?`1px solid ${accentColor}44`:'1px solid rgba(255,255,255,0.07)' }}>
                      <input type="checkbox" checked={checked} onChange={e => setField('selectedResources', e.target.checked?[...form.selectedResources,opt.type]:form.selectedResources.filter(t=>t!==opt.type))} style={{ accentColor, width:14, height:14, cursor:'pointer', marginTop:2, flexShrink:0 }} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <span style={{ fontSize:13, fontWeight:600, color:'#c8d4f0' }}>{opt.label}</span>
                          <span style={{ fontSize:10, color:opt.scalesToZero?'#4285f4':'#4a5568', background:opt.scalesToZero?'rgba(66,133,244,0.1)':'rgba(255,255,255,0.05)', border:opt.scalesToZero?'1px solid rgba(66,133,244,0.2)':'1px solid rgba(255,255,255,0.07)', borderRadius:100, padding:'1px 7px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.4px' }}>{opt.scalesToZero?'scales to zero':opt.alwaysOn?'always on':''}</span>
                        </div>
                        {opt.desc && <div style={{ fontSize:11, color:'#4a6080', marginTop:3 }}>{opt.desc}</div>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {form.projectType==='normal' && hasCloudRun && (
            <div style={s.field}>
              <label style={s.label}>Known Cloud Run Services</label>
              <input value={form.knownServices} onChange={e => setField('knownServices', e.target.value)} placeholder="e.g. my-api, auth-service" style={s.input} />
            </div>
          )}
          {form.projectType==='normal' && (
            <div style={s.field}>
              <label style={s.label}>Other Services</label>
              <input value={form.customResources} onChange={e => setField('customResources', e.target.value)} placeholder="e.g. Redis, Kafka" style={s.input} />
            </div>
          )}
          {saveError && <div style={{ fontSize:12, color:'#ff4d6d', marginTop:4, padding:'8px 12px', background:'rgba(255,77,109,0.08)', borderRadius:6, border:'1px solid rgba(255,77,109,0.2)' }}>⚠ {saveError}</div>}
        </div>
        <div style={s.footer}>
          <button onClick={goBack} style={s.btnSecondary} disabled={saving}>Cancel</button>
          <button onClick={handleSubmit} style={{ ...s.btnPrimary, background:accentColor, opacity:saving?0.65:1 }} disabled={saving}>{saving?'Saving…':'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
};

// ─── SERVICE QUERIES & FACET HELPERS ─────────────────────────────────────────
const SERVICE_QUERIES = {
  gcp_cloudrun:    (p) => `SELECT count(*) AS val FROM GcpRunRevisionSample WHERE projectId = '${p.gcpProjectId}' FACET serviceName SINCE 1 year ago LIMIT 100`,
  gcp_cloudsql:    (p) => `SELECT count(*) AS val FROM GcpCloudSqlSample WHERE projectId = '${p.gcpProjectId}' FACET displayName SINCE 30 minutes ago LIMIT 20`,
  gcp_bigquery:    (p) => `SELECT count(*) AS val FROM GcpBigQueryDataSetSample WHERE projectId = '${p.gcpProjectId}' FACET datasetId SINCE 30 minutes ago LIMIT 20`,
  aws_apprunner:   ()  => "SELECT count(*) AS val FROM Metric WHERE aws.Namespace = 'AWS/AppRunner' FACET aws.apprunner.ServiceName SINCE 5 minutes ago LIMIT 30",
  aws_rds:         ()  => "SELECT latest(provider.dbInstanceIdentifier) AS val FROM DatastoreSample WHERE provider = 'RdsDbInstance' FACET provider.dbInstanceIdentifier SINCE 7 days ago LIMIT 20",
  aws_ec2:         ()  => "SELECT latest(`aws.ec2.StatusCheckFailed`) AS statusFailed, latest(`aws.ec2.CPUUtilization`) AS cpu FROM Metric WHERE aws.Namespace = 'AWS/EC2' FACET `aws.ec2.InstanceId` SINCE 30 days ago LIMIT 50",
  aws_ec2_managed: ()  => "SELECT latest(`aws.ec2.StatusCheckFailed`) AS statusFailed, latest(`aws.ec2.CPUUtilization`) AS cpu FROM Metric WHERE aws.Namespace = 'AWS/EC2' AND `aws.ec2.tag.ManagedBy` = 'eagle-eye' FACET `aws.ec2.InstanceId` SINCE 30 days ago LIMIT 50",
  aws_cloudfront:  ()  => "SELECT count(*) AS val FROM Metric WHERE aws.Namespace = 'AWS/CloudFront' FACET aws.cloudfront.DistributionId SINCE 24 hours ago LIMIT 20",
};

const extractFacetName = (series) => {
  const groups = series?.metadata?.groups;
  if (Array.isArray(groups)) { const g = groups.find(g => g.type==='facet'); if (g?.value && g.value!=='Other') return g.value; }
  const pt = series?.data?.[0];
  if (pt?.facet) return Array.isArray(pt.facet) ? pt.facet[0] : String(pt.facet);
  const name = series?.metadata?.name;
  const SKIP = new Set(['val','Other','unknown','count','latest','FreeableMemory','WriteIOPS','WriteLatency','ReadIOPS','CPUUtilization']);
  if (name && !SKIP.has(name)) return name;
  return null;
};

const extractEc2FacetPair = (series) => {
  let name = null;
  const groups = series?.metadata?.groups;
  if (Array.isArray(groups)) { const f = groups.filter(g=>g.type==='facet'); if (f.length>=1) name=f[0].value; }
  if (!name) { const pt=series?.data?.[0]; if (pt?.facet) name=Array.isArray(pt.facet)?pt.facet[0]:String(pt.facet); }
  if (!name) { const n=series?.metadata?.name; const SKIP=new Set(['val','Other','unknown','count','statusFailed','cpu']); if (n&&!SKIP.has(n)) name=n; }
  if (!name) return null;
  const pt=series?.data?.[0]; const sf=pt?.statusFailed??null;
  return { name, state: (sf===null||sf===undefined)?'stopped':sf>0?'impaired':'running' };
};

const Ec2CountLoader = ({ onCounts, loaded, managedOnly = false }) => {
  const tagFilter = managedOnly ? "AND `aws.ec2.tag.ManagedBy` = 'eagle-eye'" : '';
  const midQ   = `SELECT latest(\`aws.ec2.StatusCheckFailed\`) AS statusFailed FROM Metric WHERE aws.Namespace = 'AWS/EC2' ${tagFilter} FACET \`aws.ec2.InstanceId\` SINCE 7 days ago LIMIT 50`;
  const innerQ = `SELECT latest(\`aws.ec2.StatusCheckFailed\`) AS statusFailed FROM Metric WHERE aws.Namespace = 'AWS/EC2' ${tagFilter} FACET \`aws.ec2.InstanceId\` SINCE 10 minutes ago LIMIT 50`;
  return (
    <NrqlQuery accountIds={[ACCOUNT_ID]} query={midQ} pollInterval={60000}>
      {({ data: midData }) => (
        <NrqlQuery accountIds={[ACCOUNT_ID]} query={innerQ} pollInterval={60000}>
          {({ data: innerData }) => {
            if (!midData || !innerData) return null;
            const recentIds = new Set(), impairedIds = new Set();
            (innerData||[]).forEach(s => { const p=extractEc2FacetPair(s); if (!p?.name) return; recentIds.add(p.name); if (p.state==='impaired') impairedIds.add(p.name); });
            const seen = new Set(); let run=0, stop=0, imp=0;
            (midData||[]).forEach(s => { const p=extractEc2FacetPair(s); if (!p?.name||seen.has(p.name)) return; seen.add(p.name); if (impairedIds.has(p.name)) imp++; else if (recentIds.has(p.name)) run++; else stop++; });
            if (!loaded) setTimeout(() => onCounts({ run, stop, imp }), 0);
            return null;
          }}
        </NrqlQuery>
      )}
    </NrqlQuery>
  );
};

const ExpandableResourceRow = ({ resource: r, project }) => {
  const [open, setOpen] = React.useState(false);
  const [ec2Counts, setEc2Counts] = React.useState(null);
  const isManagedEc2 = r.type === 'aws_ec2_managed';
  const hasSubList   = !!(SERVICE_QUERIES[r.type]);
  const dotCls       = r.status==='green'?'green':r.status==='yellow'?'yellow':r.status==='red'?'red':'grey';
  const statusColor  = r.status==='green'?'#00d4aa':r.status==='yellow'?'#f5a623':r.status==='red'?'#ff4d6d':'#7a8aaa';
  const isPaused     = canBePaused(r.type, r.row);
  const statusLabel  = r.status==='green'?'✓ Running':r.status==='yellow'?(isPaused?'⊘ Paused':r.alwaysOn?'⚠ Warning':'✗ Stopped'):r.status==='red'?(r.alwaysOn?'✗ Errors':'✗ Stopped'):'— No Data';
  const query        = hasSubList ? SERVICE_QUERIES[r.type](project) : null;

  return (
    <div style={{ borderRadius:6, overflow:'hidden', background:'rgba(255,255,255,0.03)' }}>
      {(r.type === 'aws_ec2' || isManagedEc2) && <Ec2CountLoader onCounts={setEc2Counts} loaded={!!ec2Counts} managedOnly={isManagedEc2} />}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 8px', cursor:hasSubList?'pointer':'default' }} onClick={() => hasSubList && setOpen(o=>!o)}>
        <span className={'status-dot status-dot--'+dotCls} style={{ flexShrink:0, alignSelf:'flex-start', marginTop:3 }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            <span style={{ fontWeight:600, fontSize:'0.8rem', color:'#f0f4ff' }}>{r.label}</span>
            {(r.type === 'aws_ec2' || isManagedEc2) && ec2Counts && (
              <span style={{ fontSize:10, fontWeight:700 }}>
                {ec2Counts.run  > 0 && <span style={{ color:'#00d4aa' }}>{ec2Counts.run} running</span>}
                {ec2Counts.run  > 0 && ec2Counts.stop > 0 && <span style={{ color:'#7a8aaa' }}> · </span>}
                {ec2Counts.stop > 0 && <span style={{ color:'#f5a623' }}>{ec2Counts.stop} stopped</span>}
                {(ec2Counts.run > 0 || ec2Counts.stop > 0) && ec2Counts.imp > 0 && <span style={{ color:'#7a8aaa' }}> · </span>}
                {ec2Counts.imp  > 0 && <span style={{ color:'#ff4d6d' }}>{ec2Counts.imp} impaired</span>}
              </span>
            )}
          </div>
          {r.reason && <div style={{ fontSize:'0.7rem', color:statusColor, opacity:0.85, marginTop:2, lineHeight:1.4, fontWeight:500 }}>{r.reason}</div>}
        </div>
        <span style={{ color:statusColor, fontSize:'0.75rem', fontWeight:600, flexShrink:0 }}>{statusLabel}</span>
        {hasSubList && <span style={{ fontSize:14, color:'#3d4a66', transition:'transform 0.2s', display:'inline-block', transform:open?'rotate(90deg)':'rotate(0deg)', flexShrink:0 }}>›</span>}
      </div>
      {open && query && (
        <NrqlQuery accountIds={[ACCOUNT_ID]} query={query} pollInterval={60000}>
          {({ data, loading }) => {
            if (loading) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa', fontStyle:'italic' }}>Loading…</div>;
            if (!data || data.length===0) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa' }}>No instances found</div>;
            const acC = r.type.startsWith('aws') ? 'rgba(255,153,0,0.08)' : 'rgba(66,133,244,0.08)';
            const boC = r.type.startsWith('aws') ? 'rgba(255,153,0,0.12)' : 'rgba(66,133,244,0.12)';

            if (r.type === 'gcp_cloudrun') {
              const aq = `SELECT sum(container.BillableInstanceTime) AS billableTime FROM GcpRunRevisionSample WHERE projectId = '${project.gcpProjectId}' FACET serviceName SINCE 30 minutes ago LIMIT 100`;
              return (
                <NrqlQuery accountIds={[ACCOUNT_ID]} query={aq} pollInterval={60000}>
                  {({ data: ad, loading: al }) => {
                    if (al) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa', fontStyle:'italic' }}>Loading…</div>;
                    const activeServices = new Set();
                    (ad||[]).forEach(series => {
                      let name=null; const g=series?.metadata?.groups;
                      if (Array.isArray(g)) { const f=g.find(x=>x.type==='facet'); if (f?.value) name=f.value; }
                      if (!name) { const pt=series?.data?.[0]; if (pt?.facet) name=Array.isArray(pt.facet)?pt.facet[0]:String(pt.facet); }
                      if (!name) name=series?.metadata?.name;
                      const b=series?.data?.[0]?.y??0; if (name&&b>0) activeServices.add(name);
                    });
                    const seen=new Set(), NONSVC=new Set(['val','Other','unknown','count','latest']);
                    const allServices=data.map(series=>{
                      let name=null; const g=series?.metadata?.groups;
                      if (Array.isArray(g)) { const f=g.find(x=>x.type==='facet'); if (f?.value) name=f.value; }
                      if (!name) { const pt=series?.data?.[0]; if (pt?.facet) name=Array.isArray(pt.facet)?pt.facet[0]:String(pt.facet); }
                      if (!name) name=series?.metadata?.name;
                      if (!name||NONSVC.has(name)||seen.has(name)) return null;
                      seen.add(name); return name;
                    }).filter(Boolean);
                    (project.knownServices||[]).forEach(s=>{ if (!seen.has(s)) { seen.add(s); allServices.push(s); } });
                    if (allServices.length===0) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa' }}>No services found</div>;
                    allServices.sort((a,b)=>{ const aA=activeServices.has(a),bA=activeServices.has(b); if (aA!==bA) return bA?1:-1; return a.localeCompare(b); });
                    return (
                      <div style={{ margin:'0 8px 6px', background:acC, border:`1px solid ${boC}`, borderRadius:6, overflow:'hidden' }}>
                        {allServices.map((name,i)=>(
                          <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 10px', borderBottom:i<allServices.length-1?'1px solid rgba(255,255,255,0.04)':'none' }}>
                            <span className="status-dot status-dot--green" style={{ width:6, height:6, flexShrink:0 }} />
                            <span style={{ fontSize:11, color:'#c8d4f0', fontFamily:'monospace', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
                            <span style={{ fontSize:10, color:'#00d4aa', fontWeight:600 }}>{activeServices.has(name)?'▶ Running':'◼ Scaled to zero'}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                </NrqlQuery>
              );
            }

            if (r.type === 'aws_apprunner') {
              const aq = "SELECT max(`aws.apprunner.ActiveInstances`) AS activeInstances FROM Metric WHERE aws.Namespace = 'AWS/AppRunner' FACET aws.apprunner.ServiceName SINCE 5 minutes ago LIMIT 30";
              return (
                <NrqlQuery accountIds={[ACCOUNT_ID]} query={aq} pollInterval={60000}>
                  {({ data: ad, loading: al }) => {
                    if (al) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa', fontStyle:'italic' }}>Loading…</div>;
                    const activeMap = {};
                    (ad||[]).forEach(series => {
                      let name=null; const g=series?.metadata?.groups;
                      if (Array.isArray(g)) { const f=g.find(x=>x.type==='facet'); if (f?.value) name=f.value; }
                      if (!name) { const pt=series?.data?.[0]; if (pt?.facet) name=Array.isArray(pt.facet)?pt.facet[0]:String(pt.facet); }
                      if (!name) return;
                      const pt=series?.data?.[0]; const ai=pt?.activeInstances??pt?.y??null;
                      if (name&&ai!==null) activeMap[name]=ai;
                    });
                    const seen=new Set(), NONSVC=new Set(['val','Other','unknown','count','activeInstances']);
                    const services=data.map(series=>{
                      let name=null; const g=series?.metadata?.groups;
                      if (Array.isArray(g)) { const f=g.find(x=>x.type==='facet'); if (f?.value) name=f.value; }
                      if (!name) { const pt=series?.data?.[0]; if (pt?.facet) name=Array.isArray(pt.facet)?pt.facet[0]:String(pt.facet); }
                      if (!name) name=series?.metadata?.name;
                      if (!name||NONSVC.has(name)||seen.has(name)) return null;
                      seen.add(name); return name;
                    }).filter(Boolean);
                    if (services.length===0) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa' }}>No services found</div>;
                    services.sort((a,b)=>{ const aA=activeMap[a]??null,bA=activeMap[b]??null; if (aA!==null&&bA===null) return -1; if (bA!==null&&aA===null) return 1; if ((aA??0)>0&&(bA??0)===0) return -1; if ((bA??0)>0&&(aA??0)===0) return 1; return a.localeCompare(b); });
                    return (
                      <div style={{ margin:'0 8px 6px', background:acC, border:`1px solid ${boC}`, borderRadius:6, overflow:'hidden' }}>
                        {services.map((name,i)=>{
                          const ai=activeMap[name]??null, sDot=ai===null?'grey':ai>0?'green':'yellow', sLabel=ai===null?'— Unknown':ai>0?'✓ Running':'⊘ Paused', sColor=ai===null?'#7a8aaa':ai>0?'#00d4aa':'#f5a623';
                          return (
                            <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 10px', borderBottom:i<services.length-1?'1px solid rgba(255,255,255,0.04)':'none' }}>
                              <span className={'status-dot status-dot--'+sDot} style={{ width:6, height:6, flexShrink:0 }} />
                              <span style={{ fontSize:11, color:'#c8d4f0', fontFamily:'monospace', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
                              <span style={{ fontSize:10, color:sColor, fontWeight:600 }}>{sLabel}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }}
                </NrqlQuery>
              );
            }

            if (r.type === 'aws_ec2' || r.type === 'aws_ec2_managed') {
              const tagFilter = r.type==='aws_ec2_managed' ? "AND `aws.ec2.tag.ManagedBy` = 'eagle-eye'" : '';
              const aq = `SELECT latest(\`aws.ec2.StatusCheckFailed\`) AS statusFailed FROM Metric WHERE aws.Namespace = 'AWS/EC2' ${tagFilter} FACET \`aws.ec2.InstanceId\` SINCE 10 minutes ago LIMIT 50`;
              const mq = `SELECT latest(\`aws.ec2.StatusCheckFailed\`) AS statusFailed FROM Metric WHERE aws.Namespace = 'AWS/EC2' ${tagFilter} FACET \`aws.ec2.InstanceId\` SINCE 7 days ago LIMIT 50`;
              return (
                <NrqlQuery accountIds={[ACCOUNT_ID]} query={aq} pollInterval={60000}>
                  {({ data: ad, loading: al }) => (
                    <NrqlQuery accountIds={[ACCOUNT_ID]} query={mq} pollInterval={60000}>
                      {({ data: md, loading: ml }) => {
                        if (al||ml) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa', fontStyle:'italic' }}>Loading…</div>;
                        const activeI=new Set(), impairedI=new Set();
                        (ad||[]).forEach(s => { const p=extractEc2FacetPair(s); if (!p?.name) return; activeI.add(p.name); if (p.state==='impaired') impairedI.add(p.name); });
                        const seen=new Set(), visibleInstances=[];
                        (md||[]).forEach(s => { const p=extractEc2FacetPair(s); if (!p?.name||seen.has(p.name)) return; seen.add(p.name); visibleInstances.push({ name:p.name, state:impairedI.has(p.name)?'impaired':activeI.has(p.name)?'running':'stopped' }); });
                        if (visibleInstances.length===0) return <div style={{ padding:'8px 12px 6px', fontSize:11, color:'#7a8aaa', fontStyle:'italic' }}>No active instances found</div>;
                        const ord={running:0,pending:1,stopping:2,stopped:3,impaired:4};
                        visibleInstances.sort((a,b) => { const ao=ord[a.state]??99,bo=ord[b.state]??99; return ao!==bo?ao-bo:a.name.localeCompare(b.name); });
                        return (
                          <div style={{ margin:'0 8px 6px', background:acC, border:`1px solid ${boC}`, borderRadius:6, overflow:'hidden' }}>
                            {visibleInstances.map((inst,i) => { const d=ec2StateDisplay(inst.state); return (
                              <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 10px', borderBottom:i<visibleInstances.length-1?'1px solid rgba(255,255,255,0.04)':'none' }}>
                                <span className={'status-dot status-dot--'+d.dot} style={{ width:6, height:6, flexShrink:0 }} />
                                <span style={{ fontSize:11, color:'#c8d4f0', fontFamily:'monospace', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{inst.name}</span>
                                <span style={{ fontSize:10, color:d.color, fontWeight:600 }}>{d.label}</span>
                              </div>
                            ); })}
                          </div>
                        );
                      }}
                    </NrqlQuery>
                  )}
                </NrqlQuery>
              );
            }

            const seen=new Set();
            const items=data.map(s=>{ const n=extractFacetName(s); if (!n||seen.has(n)) return null; seen.add(n); return n; }).filter(Boolean);
            if (items.length===0) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa' }}>No instances found</div>;
            const iD=r.status==='green'?'green':r.status==='red'?'red':'yellow';
            const iL=r.status==='green'?'✓ Running':r.type==='aws_cloudfront'&&r.status==='red'?'✗ Errors':r.type==='aws_cloudfront'&&r.status==='yellow'?'⚠ Warning':canBePaused(r.type,r.row)?'⊘ Paused':'✗ Stopped';
            const iC=r.status==='green'?'#00d4aa':r.status==='red'?'#ff4d6d':'#f5a623';
            return (
              <div style={{ margin:'0 8px 6px', background:acC, border:`1px solid ${boC}`, borderRadius:6, overflow:'hidden' }}>
                {items.map((name,i)=>(
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 10px', borderBottom:i<items.length-1?'1px solid rgba(255,255,255,0.04)':'none' }}>
                    <span className={'status-dot status-dot--'+iD} style={{ width:6, height:6, flexShrink:0 }} />
                    <span style={{ fontSize:11, color:'#c8d4f0', fontFamily:'monospace', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
                    <span style={{ fontSize:10, color:iC, fontWeight:600 }}>{iL}</span>
                  </div>
                ))}
              </div>
            );
          }}
        </NrqlQuery>
      )}
    </div>
  );
};

const BillingSimple = ({ cost, budget }) => {
  if (cost===null) return <div style={{ color:'#7a8aaa', fontSize:12, fontStyle:'italic' }}>No billing data</div>;
  const now=new Date(), day=now.getDate(), dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate(), est=(cost/day)*dim;
  const status=billingCostToStatus(cost), estStatus=estimatedCostToStatus(est);
  const col=status==='red'?'#ff4d6d':status==='yellow'?'#f5a623':'#00d4aa', eCol=estStatus==='red'?'#ff4d6d':estStatus==='yellow'?'#f5a623':'#00d4aa';
  const pct=Math.min((cost/budget)*100,100), fPct=((cost/budget)*100).toFixed(1);
  const st={flex:1,padding:'8px 10px',background:'rgba(255,255,255,0.03)',borderRadius:8,border:'1px solid rgba(255,255,255,0.07)'};
  const lb={fontSize:10,color:'#7a8aaa',textTransform:'uppercase',letterSpacing:1,marginBottom:4};
  const vl=(c)=>({fontSize:18,fontWeight:800,color:c});
  return (
    <div style={{ padding:'6px 4px' }}>
      <div style={{ display:'flex', gap:8, marginBottom:10 }}>
        <div style={st}><div style={lb}>Current</div><div style={vl(col)}>{'₹'+cost.toFixed(0)}</div></div>
        <div style={st}><div style={lb}>Est. Month-end</div><div style={vl(eCol)}>{'₹'+est.toFixed(0)}</div></div>
        <div style={st}><div style={lb}>Budget</div><div style={vl('#f0f4ff')}>{'₹'+budget}</div></div>
      </div>
      <div style={{ background:'rgba(255,255,255,0.06)', borderRadius:4, height:6, overflow:'hidden' }}>
        <div style={{ height:'100%', width:pct+'%', background:col, borderRadius:4, transition:'width 0.4s' }} />
      </div>
      <div style={{ marginTop:4, fontSize:10, color:col, textAlign:'right', fontWeight:600 }}>{fPct}% of budget used · Day {day} of {dim}</div>
    </div>
  );
};

const GcpBillingNotConfigured = () => (
  <div style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 12px', background:'rgba(66,133,244,0.06)', border:'1px dashed rgba(66,133,244,0.25)', borderRadius:8, margin:'4px 0' }}>
    <span style={{ fontSize:16, lineHeight:1.2, opacity:0.6 }}>🔧</span>
    <div>
      <div style={{ fontSize:12, fontWeight:700, color:'#4285f4', marginBottom:2 }}>Not Configured</div>
      <div style={{ fontSize:11, color:'#7a8aaa', lineHeight:1.5 }}>GCP Billing export to BigQuery has not been set up yet.</div>
    </div>
  </div>
);

// ─── PROJECT ROW ──────────────────────────────────────────────────────────────
const ProjectRow = ({ project, resourceStatuses, loading, index, billingCost, onInfraAction }) => {
  const [expanded,     setExpanded]     = useState(false);
  const [lifecycle,    setLifecycle]    = useState(null);
  const [actionState,  setActionState]  = useState(INFRA_STATES.IDLE);
  const [activeAction, setActiveAction] = useState(null);
  const pollCancelRef = useRef({ cancelled: false });

  // Read GitHub token from context
  const ghToken = React.useContext(GhTokenContext);

  // ── TF file check — runs as soon as component mounts and token is available.
  // NOT gated on expanded; we need the result to drive button state at all times.
  const { loading: tfLoading, hasTf } = useGithubTfFiles(project.projectDirName, ghToken);

  // Infra buttons are only enabled when TF files are confirmed present.
  const infraReady = hasTf === true;

  // Human-readable reason used in the dropdown when all buttons are disabled.
  const infraDisabledReason = (() => {
    if (!project.projectDirName)         return 'No project directory configured';
    if (!ghToken)                        return 'Set GitHub token (⚙ Config) to enable';
    if (tfLoading || hasTf === null)     return 'Checking repo for Terraform files…';
    if (hasTf === false)                 return 'No .tf files found — add infra first';
    return '';
  })();

  useEffect(() => { return () => { pollCancelRef.current.cancelled = true; }; }, []);

  const getDisabledActions = () => {
    // Block all 4 infra actions when TF files are absent / unconfirmed
    if (!infraReady) return ['apply', 'stop', 'start', 'terminate'];
    // Block all while a workflow is in flight
    if (actionState !== INFRA_STATES.IDLE && actionState !== INFRA_STATES.SUCCEEDED &&
        actionState !== INFRA_STATES.FAILED && actionState !== INFRA_STATES.TIMEOUT) {
      return ['apply', 'stop', 'start', 'terminate'];
    }
    if (!lifecycle) return [];
    const allowed = ALLOWED_ACTIONS[lifecycle] || [];
    return ['apply', 'stop', 'start', 'terminate'].filter(a => !allowed.includes(a));
  };

  const handleActionDispatched = useCallback((action, token, dispatchTime) => {
    setActiveAction(action); setActionState(INFRA_STATES.DISPATCHING);
    const effectiveDispatchTime = (dispatchTime || Date.now()) - 10000;
    pollCancelRef.current = { cancelled: false };
    const cancelRef = pollCancelRef.current;
    const onStatusChange = (newState) => { if (!cancelRef.cancelled) setActionState(newState); };
    const onComplete = (conclusion) => {
      if (cancelRef.cancelled) return;
      if (conclusion === 'success') { setActionState(INFRA_STATES.SUCCEEDED); const next=NEXT_LIFECYCLE[action]; if (next) setLifecycle(next); }
      else if (conclusion === 'timeout') setActionState(INFRA_STATES.TIMEOUT);
      else setActionState(INFRA_STATES.FAILED);
      setTimeout(() => { if (!cancelRef.cancelled) { setActionState(INFRA_STATES.IDLE); setActiveAction(null); } }, 8000);
    };
    if (token && token.trim() !== '') {
      pollWorkflowRun(token, effectiveDispatchTime, onStatusChange, onComplete, cancelRef);
    } else {
      setTimeout(() => {
        if (!cancelRef.cancelled) { setActionState(INFRA_STATES.TIMEOUT); setTimeout(() => { if (!cancelRef.cancelled) { setActionState(INFRA_STATES.IDLE); setActiveAction(null); } }, 6000); }
      }, 3000);
    }
  }, []);

  const handleInfraAction = useCallback((proj, action) => {
    onInfraAction(proj, action, handleActionDispatched);
  }, [onInfraAction, handleActionDispatched]);

  const disabledActions = getDisabledActions();
  const isBusy = actionState === INFRA_STATES.DISPATCHING || actionState === INFRA_STATES.RUNNING;

  // ── Deleted ──────────────────────────────────────────────────────────────────
  if (project.deleted) return (
    <div className="project-row project-row--deleted" style={{ animationDelay:index*80+'ms' }}>
      <div className="project-row__main">
        <div className="project-row__left" style={{ gap:10 }}><span style={{ fontSize:14, opacity:0.65 }}>🗑</span><span className="project-row__name" style={{ color:'#8899bb' }}>{project.name}</span></div>
        <div className="project-row__right"><span className="project-row__deleted-badge">Archived</span>{project.dashboardGuid && <DashboardIcon onClick={() => openDashboard(project)} />}</div>
      </div>
    </div>
  );

  // ── Billing only ──────────────────────────────────────────────────────────────
  if (project.billingOnly) {
    const totalCost = billingCost ?? null;
    if (project.billingNotConfigured) return (
      <div className={'project-row project-row--billing'+(expanded?' project-row--expanded':'')} style={{ animationDelay:index*80+'ms' }}>
        <div className="project-row__main" onClick={() => setExpanded(p=>!p)} style={{ cursor:'pointer' }}>
          <div className="project-row__left"><span className="status-dot status-dot--grey" /><span className="project-row__name">{project.name}</span><span style={{ fontSize:10, fontWeight:600, color:'#4285f4', background:'rgba(66,133,244,0.12)', border:'1px solid rgba(66,133,244,0.25)', borderRadius:100, padding:'2px 8px', textTransform:'uppercase' }}>Not Configured</span></div>
          <div className="project-row__right"><span className={'project-row__chevron'+(expanded?' project-row__chevron--open':'')}>›</span></div>
        </div>
        {expanded && <div className="project-row__detail" style={{ paddingBottom:12 }}><GcpBillingNotConfigured /></div>}
      </div>
    );
    const costLabel=totalCost!=null?'₹'+totalCost.toFixed(0):null, bS=billingCostToStatus(totalCost), dC=bS==='unknown'?'grey':bS;
    return (
      <div className={'project-row project-row--billing'+(expanded?' project-row--expanded':'')+(bS!=='unknown'?' project-row--'+bS:'')} style={{ animationDelay:index*80+'ms' }}>
        <div className="project-row__main" onClick={() => setExpanded(p=>!p)} style={{ cursor:'pointer' }}>
          <div className="project-row__left"><span className={'status-dot status-dot--'+dC} /><span className="project-row__name">{project.name}</span>{costLabel && <span className="project-row__uptime-pill">{costLabel} this month</span>}</div>
          <div className="project-row__right"><span className={'project-row__chevron'+(expanded?' project-row__chevron--open':'')}>›</span><DashboardIcon onClick={e=>{ e.stopPropagation(); openDashboard(project); }} /></div>
        </div>
        {expanded && <div className="project-row__detail" style={{ paddingBottom:12 }}><BillingSimple cost={totalCost} budget={BILLING_BUDGET_INR} /></div>}
      </div>
    );
  }

  // ── Empty (no monitoring) ─────────────────────────────────────────────────────
  if (project.empty) return (
    <div className="project-row project-row--clickable" style={{ animationDelay:index*80+'ms', cursor:'pointer', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:10, marginBottom:4 }} onClick={() => openDashboard(project)}>
      <div className="project-row__main">
        <div className="project-row__left" style={{ gap:10 }}>
          <span style={{ fontSize:14, color:'#7a8aaa' }}>◎</span>
          <span className="project-row__name" style={{ color:'#c8d4f0' }}>{project.name}</span>
          {/* No Infra badge for empty projects */}
          {!infraReady && !tfLoading && <NoInfraBadge />}
          {tfLoading && <NoInfraBadge checking />}
        </div>
        <div className="project-row__right">
          <ProjectDotsDropdown project={project} onAction={handleInfraAction} disabledActions={disabledActions} activeAction={activeAction} infraReason={infraDisabledReason} />
          <span style={{ fontSize:10, fontWeight:600, color:'#8899bb', background:'rgba(100,120,170,0.18)', border:'1px solid rgba(100,120,170,0.4)', borderRadius:100, padding:'2px 10px', textTransform:'uppercase' }}>No Monitoring</span>
          <DashboardIcon onClick={e => { e.stopPropagation(); openDashboard(project); }} />
        </div>
      </div>
    </div>
  );

  // ── Normal project ────────────────────────────────────────────────────────────
  const status       = loading ? 'unknown' : worstStatus(resourceStatuses.map(r=>r.status));
  const hasResources = project.resources && project.resources.length > 0;
  const hasDashboard = !!(project.dashboardGuid || project.dashboardLink);
  const handleRowClick = useCallback(() => {
    if (hasResources || project.projectDirName) setExpanded(p=>!p);
    else if (hasDashboard) openDashboard(project);
  }, [project, hasResources, hasDashboard]);

  const uptimeSummary = (() => {
    if (loading) return null;
    const cr = resourceStatuses.filter(r=>r.type==='gcp_cloudrun'&&r.row);
    if (cr.length===0) return null;
    if (cr.every(r=>r.status==='green')) return '100%';
    if (cr.some(r=>r.status==='green'))  return 'Partial';
    return 'Down';
  })();

  const billingSummary = (() => {
    if (loading) return null;
    const b = resourceStatuses.find(r=>r.type==='aws_billing'&&r.row);
    if (!b || b.row?.totalCostINR == null) return null;
    return `₹${b.row.totalCostINR.toFixed(0)}`;
  })();

  // ── Terminated lifecycle ──────────────────────────────────────────────────────
  if (lifecycle === 'terminated') {
    return (
      <div className={`project-row project-row--deleted${expanded?' project-row--expanded':''}`} style={{ animationDelay:`${index*80}ms`, borderColor:'rgba(255,77,109,0.35)' }}>
        <div className="project-row__main" onClick={() => setExpanded(p=>!p)} style={{ cursor:'pointer' }}>
          <div className="project-row__left">
            <span className="status-dot status-dot--grey" />
            <span className="project-row__name">{project.name}</span>
            <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:10, fontWeight:700, color:'#ff4d6d', background:'rgba(255,77,109,0.12)', border:'1px solid rgba(255,77,109,0.3)', borderRadius:100, padding:'2px 8px', textTransform:'uppercase' }}>
              <PowerOffIcon size={10} color="#ff4d6d" /> Terminated
            </span>
            {isBusy && <InfraStatusBanner actionState={actionState} lastAction={activeAction} onDismiss={() => { setActionState(INFRA_STATES.IDLE); setActiveAction(null); }} />}
          </div>
          <div className="project-row__right">
            <button onClick={e => { e.stopPropagation(); if (!isBusy && infraReady) handleInfraAction(project, 'apply'); }} disabled={isBusy || !infraReady}
              style={{ padding:'4px 12px', borderRadius:6, border:'1px solid rgba(66,133,244,0.6)', background:'rgba(66,133,244,0.15)', color:isBusy||!infraReady?'#6a7a8a':'#4285f4', fontWeight:700, fontSize:11, cursor:isBusy||!infraReady?'not-allowed':'pointer', outline:'none', display:'flex', alignItems:'center', gap:5, opacity:isBusy||!infraReady?0.5:1 }}>
              {isBusy ? <SpinnerIcon size={11} color="#4285f4" /> : null} ⚙ Re-provision
            </button>
            <ProjectDotsDropdown project={project} onAction={handleInfraAction} disabledActions={disabledActions} activeAction={activeAction} infraReason={infraDisabledReason} />
            <span className={`project-row__chevron${expanded?' project-row__chevron--open':''}`}>›</span>
          </div>
        </div>
        {expanded && (
          <div className="project-row__detail">
            <div style={{ padding:'8px 0 4px', color:'#7a8aaa', fontSize:12 }}>
              All resources destroyed via <code style={{ color:'#ff4d6d' }}>terraform destroy</code>. Click <strong style={{ color:'#4285f4' }}>Re-provision</strong> to restore.
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Resource detail content ───────────────────────────────────────────────────
  const renderResourceDetail = () => {
    if (loading) return <span className="project-row__detail-loading">Checking resource health…</span>;
    if (resourceStatuses.length === 0) {
      return <div style={{ fontSize:12, color:'#4a6080', fontStyle:'italic', padding:'6px 0' }}>No resources configured for monitoring.</div>;
    }
    return (
      <div className="project-row__resource-list" style={{ display:'flex', flexDirection:'column', gap:'2px', padding:'8px 0' }}>
        {resourceStatuses.map((r,i) => <ExpandableResourceRow key={i} resource={r} project={project} />)}
      </div>
    );
  };

  return (
    <div className={`project-row project-row--${isBusy?'yellow':status}${expanded?' project-row--expanded':''}${hasDashboard||hasResources||project.projectDirName?' project-row--clickable':''}`} style={{ animationDelay:`${index*80}ms` }}>
      <div className="project-row__main" onClick={handleRowClick}>
        <div className="project-row__left">
          <StatusDot status={isBusy ? 'yellow' : status} />
          <span className="project-row__name">{project.name}</span>

          {/* ── Infra status badge (shown when buttons are disabled) ── */}
          {!isBusy && (
            tfLoading
              ? <NoInfraBadge checking />
              : !infraReady
                ? <NoInfraBadge />
                : null
          )}

          {!loading && infraReady && uptimeSummary !== null && !isBusy && <span className="project-row__uptime-pill">{uptimeSummary} uptime</span>}
          {!loading && infraReady && billingSummary !== null && !isBusy && <span className="project-row__uptime-pill">{billingSummary} today</span>}
          {isBusy && (
            <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:10, fontWeight:700, color:'#f5a623', background:'rgba(245,166,35,0.1)', border:'1px solid rgba(245,166,35,0.3)', borderRadius:100, padding:'2px 8px' }}>
              <SpinnerIcon size={10} color="#f5a623" />
              {actionState === INFRA_STATES.DISPATCHING ? 'Dispatching…' : `${activeAction} running…`}
            </span>
          )}
        </div>
        <div className="project-row__right">
          <ProjectDotsDropdown project={project} onAction={handleInfraAction} disabledActions={disabledActions} activeAction={activeAction} infraReason={infraDisabledReason} />
          {(hasResources || project.projectDirName) && !loading && (
            <span className={`project-row__chevron${expanded?' project-row__chevron--open':''}`} onClick={e=>{ e.stopPropagation(); setExpanded(p=>!p); }}>›</span>
          )}
          {hasDashboard && <DashboardIcon onClick={e=>{ e.stopPropagation(); openDashboard(project); }} />}
        </div>
      </div>

      {expanded && (
        <div className="project-row__detail">
          <InfraStatusBanner actionState={actionState} lastAction={activeAction} onDismiss={() => { setActionState(INFRA_STATES.IDLE); setActiveAction(null); }} />
          {renderResourceDetail()}
        </div>
      )}
    </div>
  );
};

const openDashboard = (project) => {
  if (project.dashboardGuid) {
    try { navigation.openStackedNerdlet({ id:'dashboards.detail', urlState:{ entityGuid:project.dashboardGuid, timeRange:project.billingOnly?{ begin_time:Date.now()-30*24*60*60*1000, end_time:Date.now() }:{ duration:86400000 } } }); return; } catch (_) {}
  }
  if (project.dashboardLink) window.open(project.dashboardLink, '_blank');
};

const DotsButton = ({ onClick, accentColor }) => (
  <button onClick={onClick} title="Manage projects"
    style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:3, width:30, height:26, borderRadius:7, flexShrink:0, border:'none', outline:'none', boxShadow:'none', background:'transparent', cursor:'pointer', padding:0, transition:'background 0.15s' }}
    onMouseEnter={e => e.currentTarget.style.background = `${accentColor}22`}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
    <span style={{ width:4, height:4, borderRadius:'50%', background:accentColor, opacity:0.9, flexShrink:0 }} />
    <span style={{ width:4, height:4, borderRadius:'50%', background:accentColor, opacity:0.9, flexShrink:0 }} />
    <span style={{ width:4, height:4, borderRadius:'50%', background:accentColor, opacity:0.9, flexShrink:0 }} />
  </button>
);

const CloudCard = ({ provider, onManage, onInfraAction }) => {
  const meta = PROVIDER_META[provider.id];
  return (
    <div className={`cloud-card cloud-card--${provider.id}`} style={{ background:meta.gradient }}>
      <ProjectListInner provider={provider} projectIndex={0} results={[]} onManage={onManage} onInfraAction={onInfraAction} />
    </div>
  );
};

const extractRow = (data) => {
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = {}, SKIP = new Set(['x','begin_time','end_time','beginTimeSeconds','endTimeSeconds','timestamp','inspect','facet']);
  data.forEach(series => {
    if (!series?.data?.length) return;
    const point = series.data[0]; if (!point || typeof point !== 'object') return;
    const alias = series?.metadata?.name || series?.metadata?.contents?.[0]?.alias || series?.presentation?.name || null;
    if (alias) {
      if (point.y !== undefined && point.y !== null && typeof point.y === 'number') { row[alias] = point.y; return; }
      if (point[alias] !== undefined && point[alias] !== null && typeof point[alias] === 'number') { row[alias] = point[alias]; return; }
    }
    Object.entries(point).forEach(([k, v]) => { if (!SKIP.has(k) && typeof v === 'number' && !(k in row)) row[k] = v; });
  });
  return Object.keys(row).length > 0 ? row : null;
};

const SingleResourceQuery = ({ resource, gcpProjectId, children }) => {
  const query = buildResourceQuery(resource, gcpProjectId);
  const [timedOut, setTimedOut] = React.useState(false);
  React.useEffect(() => { const t=setTimeout(()=>setTimedOut(true),6000); return ()=>clearTimeout(t); }, [query]);
  return (
    <NrqlQuery accountIds={[ACCOUNT_ID]} query={query} pollInterval={60000}>
      {({ data, loading, error }) => {
        let rs;
        if (loading&&!timedOut) rs={ ...resource, status:'unknown', row:null, loading:true };
        else if (loading&&timedOut) rs={ ...resource, status:noData(resource), row:null, loading:false };
        else if (error||!data) rs={ ...resource, status:noData(resource), row:null, loading:false };
        else { const row=extractRow(data); const status=row===null?noData(resource):deriveResourceStatus(resource,row); const reason=deriveResourceReason(resource,row,status); rs={ ...resource, status, reason, row, loading:false }; }
        return children(rs);
      }}
    </NrqlQuery>
  );
};

const ProjectResourceLoader = ({ project, resourceIndex, collectedStatuses, projectIndex, provider, results, onManage, onInfraAction }) => {
  if (resourceIndex >= project.resources.length) {
    const anyLoading = collectedStatuses.some(r=>r.loading);
    return <ProjectListInner provider={provider} projectIndex={projectIndex+1} results={[...results,{projectIndex,loading:anyLoading,resourceStatuses:collectedStatuses}]} onManage={onManage} onInfraAction={onInfraAction} />;
  }
  const resource = project.resources[resourceIndex];
  return (
    <SingleResourceQuery resource={resource} gcpProjectId={project.gcpProjectId}>
      {rs => <ProjectResourceLoader project={project} resourceIndex={resourceIndex+1} collectedStatuses={[...collectedStatuses,rs]} projectIndex={projectIndex} provider={provider} results={results} onManage={onManage} onInfraAction={onInfraAction} />}
    </SingleResourceQuery>
  );
};

const ProjectListInner = ({ provider, projectIndex, results, onManage, onInfraAction }) => {
  if (projectIndex >= provider.projects.length) {
    if (provider.id === 'aws') {
      const bQ = `SELECT max(\`aws.billing.EstimatedCharges\`) * 92 AS totalCostINR FROM Metric WHERE aws.Namespace = 'AWS/Billing' SINCE this month`;
      return <NrqlQuery accountIds={[ACCOUNT_ID]} query={bQ} pollInterval={300000}>{({ data })=>{ const bc=data?.[0]?.data?.[0]?.y??data?.[0]?.data?.[0]?.totalCostINR??null; return <ProjectsRendered provider={provider} allResults={results} billingCost={bc} onManage={onManage} onInfraAction={onInfraAction} />; }}</NrqlQuery>;
    }
    return <ProjectsRendered provider={provider} allResults={results} billingCost={null} onManage={onManage} onInfraAction={onInfraAction} />;
  }
  const project = provider.projects[projectIndex];
  if (project.deleted||project.empty||project.billingNotConfigured||project.billingOnly||!project.resources||project.resources.length===0) {
    return <ProjectListInner provider={provider} projectIndex={projectIndex+1} results={[...results,{projectIndex,loading:false,resourceStatuses:[]}]} onManage={onManage} onInfraAction={onInfraAction} />;
  }
  return <ProjectResourceLoader project={project} resourceIndex={0} collectedStatuses={[]} projectIndex={projectIndex} provider={provider} results={results} onManage={onManage} onInfraAction={onInfraAction} />;
};

const ArchivedAwareProjectList = ({ provider, allResults, billingCost, onInfraAction }) => {
  const [archivedOpen, setArchivedOpen] = React.useState(false);
  const activeProjects   = provider.projects.filter(p => !p.deleted);
  const archivedProjects = provider.projects.filter(p => p.deleted);
  const indexOf          = (project) => provider.projects.indexOf(project);
  return (
    <>
      {activeProjects.map((project) => {
        const i = indexOf(project), r = allResults.find(res=>res.projectIndex===i) ?? allResults[i];
        return <ProjectRow key={project.projectDirName || project.name} project={project} resourceStatuses={r?.resourceStatuses??[]} loading={r?.loading??false} index={i} billingCost={project.billingOnly?billingCost:null} onInfraAction={onInfraAction} />;
      })}
      {archivedProjects.length > 0 && (
        <div style={{ marginTop:activeProjects.length>0?10:0 }}>
          <button onClick={() => setArchivedOpen(o=>!o)} style={{ display:'flex', alignItems:'center', gap:7, background:'none', border:'1px solid rgba(255,255,255,0.07)', borderRadius:8, padding:'6px 12px', cursor:'pointer', color:'#4a5568', fontSize:11, fontWeight:700, letterSpacing:'0.6px', textTransform:'uppercase', width:'100%', outline:'none' }}>
            <span style={{ display:'inline-block', transition:'transform 0.2s', transform:archivedOpen?'rotate(90deg)':'rotate(0deg)', fontSize:12 }}>›</span>
            <span>🗑 Archived</span>
            <span style={{ marginLeft:'auto', fontSize:10, background:'rgba(74,85,104,0.2)', border:'1px solid rgba(74,85,104,0.3)', borderRadius:100, padding:'1px 8px' }}>{archivedProjects.length}</span>
          </button>
          {archivedOpen && (
            <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:4 }}>
              {archivedProjects.map((project) => { const i=indexOf(project), r=allResults.find(res=>res.projectIndex===i)??allResults[i]; return <ProjectRow key={project.projectDirName||project.name} project={project} resourceStatuses={r?.resourceStatuses??[]} loading={r?.loading??false} index={i} billingCost={null} onInfraAction={onInfraAction} />; })}
            </div>
          )}
        </div>
      )}
    </>
  );
};

const ProjectsRendered = ({ provider, allResults, billingCost, onManage, onInfraAction }) => {
  const projectStatuses = provider.projects.map((p, i) => {
    if (p.deleted) return 'deleted'; if (p.empty) return 'empty'; if (p.billingNotConfigured) return 'unknown';
    if (p.billingOnly) return billingCostToStatus(billingCost);
    const r = allResults.find(res=>res.projectIndex===i) ?? allResults[i];
    if (!r||r.loading) return 'unknown';
    if (!r.resourceStatuses||r.resourceStatuses.length===0) return 'unknown';
    return worstStatus(r.resourceStatuses.map(rs=>rs.status));
  });
  const projectHealthMap = {};
  provider.projects.forEach((p, i) => { projectHealthMap[p.name] = projectStatuses[i] ?? 'unknown'; });
  const live        = projectStatuses.filter(s=>s!=='deleted'&&s!=='empty'&&s!=='unknown');
  const cloudStatus = live.length>0?worstStatus(live):'green';
  const billStatus  = billingCostToStatus(billingCost);
  const overall     = provider.id==='aws'?worstStatus([cloudStatus,billStatus].filter(s=>s!=='unknown')):cloudStatus;
  const cardMeta    = STATUS_META[overall] ?? STATUS_META.green;
  const meta        = PROVIDER_META[provider.id], accentColor = meta.accent;
  const gcpBillingProject       = provider.id==='gcp' ? provider.projects.find(p=>p.billingOnly) : null;
  const gcpBillingNotConfigured = gcpBillingProject?.billingNotConfigured ?? false;
  return (
    <>
      <style>{`.cloud-card--${provider.id}{border-color:${cardMeta.color}!important;box-shadow:0 8px 40px ${cardMeta.color}22,inset 0 1px 0 rgba(255,255,255,0.07)!important;}`}</style>
      <div className="cloud-card__header">
        <div className="cloud-card__title-group">
          <div className="cloud-card__icon" style={{ color:accentColor }}>{provider.icon}</div>
          <div><h2 className="cloud-card__name">{provider.name}</h2><span className="cloud-card__label">{provider.label}</span></div>
          <div className="cloud-card__header-pills">
            <StatusBadge status={cloudStatus} label="Resources" />
            {provider.id === 'aws' && <BillingHealthBadge cost={billingCost} />}
            {provider.id === 'gcp' && gcpBillingNotConfigured && (
              <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:100, fontSize:11, fontWeight:600, background:'rgba(66,133,244,0.10)', border:'1px solid rgba(66,133,244,0.25)', color:'#4285f4', flexShrink:0 }}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><circle cx="4" cy="4" r="3.5" stroke="#4285f4" strokeWidth="1" fill="none" /><line x1="4" y1="2" x2="4" y2="4.5" stroke="#4285f4" strokeWidth="1" strokeLinecap="round" /><circle cx="4" cy="6" r="0.6" fill="#4285f4" /></svg>
                Billing · Not Configured
              </span>
            )}
            {provider.id === 'gcp' && !gcpBillingNotConfigured && gcpBillingProject && <BillingHealthBadge cost={billingCost} />}
            <DotsButton onClick={() => onManage(projectHealthMap)} accentColor={accentColor} />
          </div>
        </div>
      </div>
      <div className="cloud-card__divider" />
      <div className="cloud-card__projects">
        <ArchivedAwareProjectList provider={provider} allResults={allResults} billingCost={billingCost} onInfraAction={onInfraAction} />
      </div>
    </>
  );
};

const EagleEyeLoader = () => (
  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', gap:16 }}>
    <div style={{ width:40, height:40, border:'3px solid rgba(66,133,244,0.2)', borderTop:'3px solid #4285f4', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <div style={{ color:'#7a8aaa', fontSize:13 }}>Loading Eagle Eye…</div>
  </div>
);

const ConfigButton = ({ hasToken, onClick }) => (
  <button onClick={onClick} title="Configure GitHub ACCESS_TOKEN"
    style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 14px', borderRadius:8, border:hasToken?'1px solid rgba(0,212,170,0.35)':'1px solid rgba(245,166,35,0.5)', background:hasToken?'rgba(0,212,170,0.07)':'rgba(245,166,35,0.1)', color:hasToken?'#00d4aa':'#f5a623', fontWeight:600, fontSize:12, cursor:'pointer', outline:'none', transition:'all 0.15s' }}
    onMouseEnter={e => e.currentTarget.style.opacity='0.8'} onMouseLeave={e => e.currentTarget.style.opacity='1'}>
    <span>{hasToken ? '✓' : '⚠'}</span>
    <span>{hasToken ? 'Token configured' : 'Set ACCESS_TOKEN'}</span>
  </button>
);

// ─── ROOT ─────────────────────────────────────────────────────────────────────
const EagleEye = () => {
  const [providers,    setProviders]    = useState(null);
  const [ghToken,      setGhToken]      = useState('');
  const [showModal,    setShowModal]    = useState(null);
  const [showConfig,   setShowConfig]   = useState(false);
  const [loadError,    setLoadError]    = useState(false);
  const [infraConfirm, setInfraConfirm] = useState(null);

  useEffect(() => {
    AccountStorageQuery.query({ accountId:ACCOUNT_ID, collection:STORAGE_COLLECTION, documentId:STORAGE_DOC_ID })
      .then(({ data, error }) => {
        if (error) { console.error('NerdStorage load error:', error); setLoadError(true); setProviders(mergeAutoDiscovered(DEFAULT_CLOUD_PROVIDERS)); }
        else if (data?.document?.providers) setProviders(mergeAutoDiscovered(data.document.providers));
        else setProviders(mergeAutoDiscovered(DEFAULT_CLOUD_PROVIDERS));
      }).catch(() => { setLoadError(true); setProviders(mergeAutoDiscovered(DEFAULT_CLOUD_PROVIDERS)); });

    AccountStorageQuery.query({ accountId:ACCOUNT_ID, collection:STORAGE_COLLECTION, documentId:STORAGE_CONFIG_ID })
      .then(({ data }) => { if (data?.document?.accessToken) setGhToken(data.document.accessToken); })
      .catch(() => {});
  }, []);

  const handleSave = async (newProviders) => {
    const { error } = await AccountStorageMutation.mutate({ accountId:ACCOUNT_ID, actionType:AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT, collection:STORAGE_COLLECTION, documentId:STORAGE_DOC_ID, document:{ providers:newProviders } });
    if (error) throw new Error('NerdStorage save failed: ' + (error.message || JSON.stringify(error)));
    setProviders(newProviders);
  };

  const handleSaveToken = async (token) => {
    const { error } = await AccountStorageMutation.mutate({ accountId:ACCOUNT_ID, actionType:AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT, collection:STORAGE_COLLECTION, documentId:STORAGE_CONFIG_ID, document:{ accessToken: token } });
    if (error) throw new Error('Failed to save token: ' + (error.message || JSON.stringify(error)));
    setGhToken(token);
  };

  if (!providers) return <EagleEyeLoader />;

  const handleInfraAction = (project, action, onDispatched) => {
    setInfraConfirm({ project, action, onDispatched });
  };

  return (
    <GhTokenContext.Provider value={ghToken}>
      <div className="eagle-eye">
        <div className="bg-orb bg-orb--blue" />
        <div className="bg-orb bg-orb--orange" />
        <div className="bg-orb bg-orb--green" />

        <header className="ee-header">
          <div className="ee-header__eyebrow">Infrastructure Monitoring</div>
          <h1 className="ee-header__title">
            <span className="ee-header__title-eagle">Eagle</span>
            <span className="ee-header__title-eye"> Eye</span>
          </h1>
          <div className="ee-header__pulse-bar">
            <span className="ee-header__pulse-dot" />
            <span className="ee-header__pulse-label">Live · auto-refreshes every 60s</span>
          </div>
          <div style={{ marginTop:10 }}>
            <ConfigButton hasToken={!!ghToken} onClick={() => setShowConfig(true)} />
          </div>
          {loadError && <div style={{ fontSize:11, color:'#f5a623', marginTop:8 }}>⚠ Could not connect to NerdStorage — showing defaults. Changes will not persist.</div>}
        </header>

        <div className="ee-grid">
          {providers.map(provider => (
            <CloudCard key={provider.id} provider={provider}
              onManage={(healthMap) => setShowModal({ providerId:provider.id, projectHealthMap:healthMap })}
              onInfraAction={handleInfraAction}
            />
          ))}
        </div>

        <footer className="ee-footer">
          <span>Click any project to expand health details · click the grid icon to open its dashboard · click ··· for infrastructure actions</span>
        </footer>

        {showModal && (
          <ProjectManagerModal providers={providers} providerId={showModal.providerId} projectHealthMap={showModal.projectHealthMap} onSave={handleSave} onClose={() => setShowModal(null)} />
        )}

        {showConfig && (
          <ConfigModal currentToken={ghToken} onSave={handleSaveToken} onClose={() => setShowConfig(false)} />
        )}

        {infraConfirm && (
          <InfraConfirmModal
            project={infraConfirm.project}
            action={infraConfirm.action}
            ghToken={ghToken}
            onConfirm={(dispatchTime) => { infraConfirm.onDispatched?.(infraConfirm.action, ghToken, dispatchTime); setInfraConfirm(null); }}
            onCancel={() => setInfraConfirm(null)}
          />
        )}
      </div>
    </GhTokenContext.Provider>
  );
};

export default EagleEye;

