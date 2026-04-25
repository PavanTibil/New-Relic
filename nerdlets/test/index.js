import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { NrqlQuery, navigation, AccountStorageMutation, AccountStorageQuery } from 'nr1';
import './styles.scss';

const GhTokenContext = React.createContext('');
const LifecycleContext = React.createContext({ lifecycles: {}, setLifecycle: () => {} });

let AUTO_DISCOVERED = {};
try {
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

    const existingProject = providerEntry.projects.find(
      p => p.projectDirName === dirName ||
           p.name === name ||
           p.name?.toLowerCase() === name?.toLowerCase()
    );

    if (existingProject) {
      if (existingProject.empty || existingProject.deleted || existingProject.billingOnly) continue;
      if (!existingProject.resources || existingProject.resources.length === 0) {
        existingProject.resources = Array.isArray(discovered.resources) ? discovered.resources : [];
      }
      continue;
    }

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
const STORAGE_LIFECYCLE_ID = 'lifecycles';

const GH_OWNER          = 'PavanTibil';
const GH_REPO           = 'New-Relic';
const GH_WORKFLOW_INFRA = 'project-actions.yml';

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

const DEFAULT_CLOUD_PROVIDERS = [
  {
    id: 'gcp', name: 'GCP', label: 'Google Cloud Platform', icon: '☁',
    projects: [
      {
        name: 'GCP Billing',
        gcpProjectId: null, dashboardGuid: null, dashboardLink: null,
        billingOnly: true, billingNotConfigured: true,
        resources: [{ label: 'Total Cost (INR)', type: 'gcp_billing', alwaysOn: false }],
      },
    ],
  },
  {
    id: 'aws', name: 'AWS', label: 'Amazon Web Services', icon: '⚡',
    projects: [
      {
        name: 'AWS Billing',
        gcpProjectId: null,
        dashboardGuid: 'Nzc4MjQ3OXxWSVp8REFTSEJPQVJEfGRhOjEyMTg1NjI5',
        dashboardLink: 'https://onenr.io/0Vwg7Wz8ZwJ',
        billingOnly: true,
        resources: [{ label: 'Total Cost (INR)', type: 'aws_billing', alwaysOn: false }],
      },
    ],
  },
];

const RESOURCE_OPTIONS = {
  gcp: [
    { type:'google_cloud_run_v2_service',    label:'Cloud Run',        desc:'Serverless containers — scales to zero when idle',  alwaysOn:false, scalesToZero:true  },
    { type:'google_sql_database_instance',   label:'Cloud SQL',        desc:'Managed relational databases (MySQL, PostgreSQL)',  alwaysOn:true                      },
    { type:'google_bigquery_dataset',        label:'BigQuery',         desc:'Serverless data warehouse & analytics engine',      alwaysOn:false                     },
    { type:'google_container_cluster',       label:'GKE',              desc:'Google Kubernetes Engine clusters',                 alwaysOn:true                      },
    { type:'google_pubsub_topic',            label:'Pub/Sub',          desc:'Managed message queues',                            alwaysOn:false                     },
    { type:'google_compute_instance',        label:'Compute Engine',   desc:'Virtual machines (GCE)',                            alwaysOn:true                      },
    { type:'google_spanner_instance',        label:'Spanner',          desc:'Globally distributed relational database',          alwaysOn:true                      },
    { type:'google_storage_bucket',          label:'Cloud Storage',    desc:'Object storage buckets',                            alwaysOn:false                     },
    { type:'google_cloudfunctions2_function',label:'Cloud Functions',  desc:'Serverless functions',                              alwaysOn:false                     },
    { type:'google_redis_instance',          label:'Memorystore Redis',desc:'Managed Redis instances',                           alwaysOn:true                      },
  ],
  aws: [
    { type:'aws_ec2',        label:'EC2',        desc:'Virtual machines — scoped to this project via tag:Project', alwaysOn:true  },
    { type:'aws_apprunner',  label:'App Runner', desc:'Managed containers & web apps — auto-scales to zero',       alwaysOn:true  },
    { type:'aws_rds',        label:'RDS',        desc:'Managed relational databases (MySQL, PostgreSQL, Aurora)',   alwaysOn:true  },
    { type:'aws_cloudfront', label:'CloudFront', desc:'Global CDN & content delivery network',                     alwaysOn:true  },
    { type:'aws_ecs',        label:'ECS',        desc:'Elastic Container Service clusters & services',             alwaysOn:true  },
    { type:'aws_lambda',     label:'Lambda',     desc:'Serverless functions',                                      alwaysOn:false },
    { type:'aws_s3',         label:'S3',         desc:'Object storage buckets',                                    alwaysOn:true  },
  ],
};

const GCP_DISCOVERY_MAP = [
  { type:'google_cloud_run_v2_service',     label:'Cloud Run',        nrTable:'GcpRunRevisionSample',       desc:'Serverless containers — scales to zero when idle',  alwaysOn:false, scalesToZero:true },
  { type:'google_sql_database_instance',    label:'Cloud SQL',        nrTable:'GcpCloudSqlSample',          desc:'Managed relational databases (MySQL, PostgreSQL)',   alwaysOn:true  },
  { type:'google_bigquery_dataset',         label:'BigQuery',         nrTable:'GcpBigQueryDataSetSample',   desc:'Serverless data warehouse & analytics engine',       alwaysOn:false },
  { type:'google_container_cluster',        label:'GKE',              nrTable:'GcpKubernetesClusterSample', desc:'Google Kubernetes Engine clusters',                  alwaysOn:true  },
  { type:'google_pubsub_topic',             label:'Pub/Sub',          nrTable:'GcpPubSubTopicSample',       desc:'Managed message queues',                             alwaysOn:false },
  { type:'google_compute_instance',         label:'Compute Engine',   nrTable:'GcpVirtualMachineSample',   desc:'Virtual machines (GCE)',                             alwaysOn:true  },
  { type:'google_spanner_instance',         label:'Spanner',          nrTable:'GcpSpannerInstanceSample',   desc:'Globally distributed relational database',           alwaysOn:true  },
  { type:'google_storage_bucket',           label:'Cloud Storage',    nrTable:'GcpStorageBucketSample',     desc:'Object storage buckets',                             alwaysOn:false },
  { type:'google_cloudfunctions2_function', label:'Cloud Functions',  nrTable:'GcpCloudFunctionsSample',   desc:'Serverless functions',                               alwaysOn:false },
  { type:'google_redis_instance',           label:'Memorystore Redis',nrTable:'GcpRedisInstanceSample',     desc:'Managed Redis instances',                            alwaysOn:true  },
];

const ec2ProjectFilter = (project) => {
  const tag = project.projectDirName || project.gcpProjectId || project.name;
  return `(\`aws.ec2.tag.Project\` = '${tag}' OR \`aws.ec2.tag.project\` = '${tag}' OR \`aws.ec2.tag.Name\` LIKE '${tag}%')`;
};

// ─── extractRow — defined here so all components below can use it ─────────────
const extractRow = (data) => {
  if (!Array.isArray(data)||data.length===0) return null;
  const row={}, SKIP=new Set(['x','begin_time','end_time','beginTimeSeconds','endTimeSeconds','timestamp','inspect','facet']);
  data.forEach(series=>{
    if (!series?.data?.length) return;
    const point=series.data[0]; if (!point||typeof point!=='object') return;
    const alias=series?.metadata?.name||series?.metadata?.contents?.[0]?.alias||series?.presentation?.name||null;
    if (alias){
      if (point.y!==undefined&&point.y!==null&&typeof point.y==='number'){row[alias]=point.y;return;}
      if (point[alias]!==undefined&&point[alias]!==null&&typeof point[alias]==='number'){row[alias]=point[alias];return;}
    }
    Object.entries(point).forEach(([k,v])=>{if(!SKIP.has(k)&&typeof v==='number'&&!(k in row))row[k]=v;});
  });
  return Object.keys(row).length>0?row:null;
};

const persistProviders = async (newProviders) => {
  console.log('[Eagle Eye] SAVING to NerdStorage:', JSON.stringify(
    newProviders.map(p => ({
      id: p.id,
      projects: p.projects?.map(j => ({ name: j.name, dirName: j.projectDirName, empty: j.empty }))
    }))
  ));
  const { error } = await AccountStorageMutation.mutate({
    accountId:  ACCOUNT_ID,
    actionType: AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT,
    collection: STORAGE_COLLECTION,
    documentId: STORAGE_DOC_ID,
    document:   { providers: newProviders },
  });
  console.log('[Eagle Eye] Save result — error:', JSON.stringify(error));
  if (error) throw new Error('NerdStorage save failed: ' + (error.message || JSON.stringify(error)));
  return newProviders;
};

const useGithubTfFiles = (projectDirName, token) => {
  const [state, setState] = React.useState({ loading: false, hasTf: null });
  React.useEffect(() => {
    if (!projectDirName) { setState({ loading: false, hasTf: false }); return; }
    if (!token)          { setState({ loading: false, hasTf: null  }); return; }
    setState({ loading: true, hasTf: null });
    let cancelled = false;
    const ghHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const checkDir = async (path, depth = 0) => {
      if (depth > 4) return false;
      const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, { headers: ghHeaders });
      if (!r.ok) return false;
      const items = await r.json();
      if (!Array.isArray(items)) return false;
      for (const item of items) {
        if (item.type === 'file' && item.name.endsWith('.tf')) return true;
        if (item.type === 'dir') { if (await checkDir(item.path, depth + 1)) return true; }
      }
      return false;
    };
    const checkProject = async () => {
      const rootPath = `projects/${projectDirName}`;
      if (await checkDir(rootPath, 0)) return true;
      return checkDir(`${rootPath}/modules`, 0);
    };
    checkProject()
      .then(hasTf  => { if (!cancelled) setState({ loading: false, hasTf }); })
      .catch(()    => { if (!cancelled) setState({ loading: false, hasTf: false }); });
    return () => { cancelled = true; };
  }, [projectDirName, token]);
  return state;
};

const useTerraformResources = (projectDirName, token) => {
  const [state, setState] = React.useState({ loading: false, resources: {} });
  React.useEffect(() => {
    if (!projectDirName || !token) { setState({ loading: false, resources: {} }); return; }
    setState({ loading: true, resources: {} });
    let cancelled = false;
    const ghHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const TF_TYPE_MAP = {
      'aws_instance':                    'aws_ec2',
      'aws_db_instance':                 'aws_rds',
      'aws_rds_cluster':                 'aws_rds',
      'aws_apprunner_service':           'aws_apprunner',
      'aws_cloudfront_distribution':     'aws_cloudfront',
      'aws_ecs_service':                 'aws_ecs',
      'aws_lambda_function':             'aws_lambda',
      'aws_s3_bucket':                   'aws_s3',
      'google_cloud_run_v2_service':     'google_cloud_run_v2_service',
      'google_sql_database_instance':    'google_sql_database_instance',
      'google_container_cluster':        'google_container_cluster',
      'google_compute_instance':         'google_compute_instance',
      'google_bigquery_dataset':         'google_bigquery_dataset',
      'google_pubsub_topic':             'google_pubsub_topic',
      'google_spanner_instance':         'google_spanner_instance',
      'google_storage_bucket':           'google_storage_bucket',
      'google_cloudfunctions2_function': 'google_cloudfunctions2_function',
      'google_redis_instance':           'google_redis_instance',
    };
    const parseTfContent = (content) => {
      const regex = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
      const found = {};
      let match;
      while ((match = regex.exec(content)) !== null) {
        const tfType = match[1], tfName = match[2];
        const internalType = TF_TYPE_MAP[tfType];
        if (!internalType) continue;
        if (!found[internalType]) found[internalType] = [];
        if (!found[internalType].includes(tfName)) found[internalType].push(tfName);
      }
      return found;
    };
    const fetchFile = async (path) => {
      const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, { headers: ghHeaders });
      if (!r.ok) return null;
      const json = await r.json();
      if (!json.content) return null;
      return atob(json.content.replace(/\n/g, ''));
    };
    const fetchDir = async (path, depth = 0) => {
      if (depth > 4) return {};
      const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`, { headers: ghHeaders });
      if (!r.ok) return {};
      const items = await r.json();
      if (!Array.isArray(items)) return {};
      const merged = {};
      for (const item of items) {
        let found = {};
        if (item.type === 'file' && item.name.endsWith('.tf')) {
          const content = await fetchFile(item.path);
          if (content) found = parseTfContent(content);
        } else if (item.type === 'dir') {
          found = await fetchDir(item.path, depth + 1);
        }
        for (const [type, names] of Object.entries(found)) {
          if (!merged[type]) merged[type] = [];
          names.forEach(n => { if (!merged[type].includes(n)) merged[type].push(n); });
        }
      }
      return merged;
    };
    fetchDir(`projects/${projectDirName}`)
      .then(resources => { if (!cancelled) setState({ loading: false, resources }); })
      .catch(()       => { if (!cancelled) setState({ loading: false, resources: {} }); });
    return () => { cancelled = true; };
  }, [projectDirName, token]);
  return state;
};

// ─── Icons ────────────────────────────────────────────────────────────────────
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

const PlayIcon  = ({ size = 11, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none"><polygon points="5,3 19,12 5,21" /></svg>
);
const StopIcon  = ({ size = 11, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none"><rect x="5" y="5" width="14" height="14" rx="1" /></svg>
);
const GearIcon  = ({ size = 11, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// ─── Workflow polling ──────────────────────────────────────────────────────────
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

const callInfraAPI = async (project, action, token) => {
  if (!token || token === '') throw new Error('GitHub ACCESS_TOKEN not configured. Click the ⚙ Config button to set it.');
  if (!project.projectDirName)   throw new Error('No project directory name configured for this project.');
  const projectPath = `projects/${project.projectDirName}`;
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

// ─── NRQL query builders ───────────────────────────────────────────────────────
const buildResourceQuery = (resource, project) => {
  const gcpProjectId = project.gcpProjectId;
  const gcpFilter    = gcpProjectId ? `WHERE projectId = '${gcpProjectId}'` : '';

  if (resource.type === 'aws_ec2') {
    const pf = ec2ProjectFilter(project);
    return `SELECT max(\`aws.ec2.StatusCheckFailed\`) AS statusCheckFailed, max(\`aws.ec2.StatusCheckFailed_Instance\`) AS instanceCheckFailed, average(\`aws.ec2.CPUUtilization\`) AS cpuUsage, count(*) AS samples FROM Metric WHERE aws.Namespace = 'AWS/EC2' AND ${pf} SINCE 5 minutes ago`;
  }

  switch (resource.type) {
    case 'google_cloud_run_v2_service':      return `SELECT sum(container.BillableInstanceTime) AS billableTime, count(*) AS samples FROM GcpRunRevisionSample ${gcpFilter} SINCE 5 minutes ago`;
    case 'google_sql_database_instance':     return `SELECT count(*) AS samples FROM GcpCloudSqlSample ${gcpFilter} SINCE 30 minutes ago`;
    case 'google_bigquery_dataset':          return `SELECT count(*) AS samples FROM GcpBigQueryDataSetSample ${gcpFilter} SINCE 30 minutes ago`;
    case 'google_container_cluster':         return `SELECT count(*) AS samples FROM GcpKubernetesClusterSample ${gcpFilter} SINCE 5 minutes ago`;
    case 'google_pubsub_topic':              return `SELECT count(*) AS samples FROM GcpPubSubTopicSample ${gcpFilter} SINCE 5 minutes ago`;
    case 'google_compute_instance':          return `SELECT count(*) AS samples, average(cpu.utilization) AS cpuUtil FROM GcpVirtualMachineSample ${gcpFilter} SINCE 5 minutes ago`;
    case 'google_spanner_instance':          return `SELECT count(*) AS samples FROM GcpSpannerInstanceSample ${gcpFilter} SINCE 5 minutes ago`;
    case 'google_storage_bucket':            return `SELECT count(*) AS samples FROM GcpStorageBucketSample ${gcpFilter} SINCE 1 hour ago`;
    case 'google_cloudfunctions2_function':  return `SELECT count(*) AS samples, sum(executionCount) AS invocations FROM GcpCloudFunctionsSample ${gcpFilter} SINCE 5 minutes ago`;
    case 'google_redis_instance':            return `SELECT count(*) AS samples FROM GcpRedisInstanceSample ${gcpFilter} SINCE 5 minutes ago`;
    case 'gcp_billing':    return `SELECT count(*) AS samples FROM Metric SINCE 1 hour ago LIMIT 1`;
    case 'aws_apprunner':  return `SELECT max(\`aws.apprunner.ActiveInstances\`) AS activeInstances, count(*) AS samples FROM Metric WHERE aws.Namespace = 'AWS/AppRunner' SINCE 5 minutes ago`;
    case 'aws_rds':        return `SELECT average(\`aws.rds.FreeableMemory\`) AS freeMemory, average(\`aws.rds.WriteLatency\`) AS writeLatency, count(*) AS samples FROM Metric WHERE aws.Namespace = 'AWS/RDS' SINCE 5 minutes ago`;
    case 'aws_cloudfront': return `SELECT count(*) AS samples, average(\`aws.cloudfront.5xxErrorRate\`) AS errorRate5xx, average(\`aws.cloudfront.TotalErrorRate\`) AS totalErrorRate FROM Metric WHERE aws.Namespace = 'AWS/CloudFront' SINCE 24 hours ago`;
    case 'aws_ecs':        return `SELECT count(*) AS samples FROM Metric WHERE aws.Namespace = 'AWS/ECS' SINCE 5 minutes ago`;
    case 'aws_lambda':     return `SELECT count(*) AS samples, sum(\`aws.lambda.Errors\`) AS errors FROM Metric WHERE aws.Namespace = 'AWS/Lambda' SINCE 5 minutes ago`;
    case 'aws_s3':         return `SELECT count(*) AS samples FROM Metric WHERE aws.Namespace = 'AWS/S3' SINCE 1 hour ago`;
    case 'aws_billing':    return `SELECT max(\`aws.billing.EstimatedCharges\`) * 92 AS totalCostINR, count(*) AS samples FROM Metric WHERE aws.Namespace = 'AWS/Billing' SINCE this month`;
    default:               return `SELECT count(*) AS samples FROM Metric WHERE entity.name = '${resource.label}' SINCE 5 minutes ago`;
  }
};

const SERVICE_QUERIES = {
  google_cloud_run_v2_service:   (p) => `SELECT count(*) AS val FROM GcpRunRevisionSample WHERE projectId = '${p.gcpProjectId}' FACET serviceName SINCE 1 year ago LIMIT 100`,
  google_sql_database_instance:  (p) => `SELECT count(*) AS val FROM GcpCloudSqlSample WHERE projectId = '${p.gcpProjectId}' FACET displayName SINCE 30 minutes ago LIMIT 20`,
  google_bigquery_dataset:       (p) => `SELECT count(*) AS val FROM GcpBigQueryDataSetSample WHERE projectId = '${p.gcpProjectId}' FACET datasetId SINCE 30 minutes ago LIMIT 20`,
  google_container_cluster:      (p) => `SELECT count(*) AS val FROM GcpKubernetesClusterSample WHERE projectId = '${p.gcpProjectId}' FACET clusterName SINCE 5 minutes ago LIMIT 20`,
  google_pubsub_topic:           (p) => `SELECT count(*) AS val FROM GcpPubSubTopicSample WHERE projectId = '${p.gcpProjectId}' FACET topicId SINCE 5 minutes ago LIMIT 20`,
  google_compute_instance:       (p) => `SELECT count(*) AS val FROM GcpVirtualMachineSample WHERE projectId = '${p.gcpProjectId}' FACET instanceName SINCE 5 minutes ago LIMIT 20`,
  google_spanner_instance:       (p) => `SELECT count(*) AS val FROM GcpSpannerInstanceSample WHERE projectId = '${p.gcpProjectId}' FACET instanceId SINCE 5 minutes ago LIMIT 20`,
  google_storage_bucket:         (p) => `SELECT count(*) AS val FROM GcpStorageBucketSample WHERE projectId = '${p.gcpProjectId}' FACET bucketName SINCE 1 hour ago LIMIT 20`,
  google_cloudfunctions2_function:(p) => `SELECT count(*) AS val FROM GcpCloudFunctionsSample WHERE projectId = '${p.gcpProjectId}' FACET functionName SINCE 5 minutes ago LIMIT 20`,
  google_redis_instance:         (p) => `SELECT count(*) AS val FROM GcpRedisInstanceSample WHERE projectId = '${p.gcpProjectId}' FACET instanceId SINCE 5 minutes ago LIMIT 20`,
  aws_apprunner:  ()  => "SELECT count(*) AS val FROM Metric WHERE aws.Namespace = 'AWS/AppRunner' FACET aws.apprunner.ServiceName SINCE 5 minutes ago LIMIT 30",
  aws_rds:        ()  => "SELECT latest(provider.dbInstanceIdentifier) AS val FROM DatastoreSample WHERE provider = 'RdsDbInstance' FACET provider.dbInstanceIdentifier SINCE 7 days ago LIMIT 20",
  aws_ec2:        (p) => { const pf = ec2ProjectFilter(p); return `SELECT latest(\`aws.ec2.StatusCheckFailed\`) AS statusFailed, latest(\`aws.ec2.CPUUtilization\`) AS cpu FROM Metric WHERE aws.Namespace = 'AWS/EC2' AND ${pf} FACET \`aws.ec2.InstanceId\` SINCE 30 days ago LIMIT 50`; },
  aws_cloudfront: ()  => "SELECT count(*) AS val FROM Metric WHERE aws.Namespace = 'AWS/CloudFront' FACET aws.cloudfront.DistributionId SINCE 24 hours ago LIMIT 20",
  aws_ecs:        ()  => "SELECT count(*) AS val FROM Metric WHERE aws.Namespace = 'AWS/ECS' FACET aws.ecs.ServiceName SINCE 5 minutes ago LIMIT 30",
  aws_lambda:     ()  => "SELECT count(*) AS val FROM Metric WHERE aws.Namespace = 'AWS/Lambda' FACET aws.lambda.FunctionName SINCE 5 minutes ago LIMIT 30",
  aws_s3:         ()  => "SELECT count(*) AS val FROM Metric WHERE aws.Namespace = 'AWS/S3' FACET aws.s3.BucketName SINCE 1 hour ago LIMIT 30",
};

const noData = (resource) => resource.scalesToZero ? 'green' : resource.alwaysOn ? 'yellow' : 'unknown';

const deriveResourceStatus = (resource, row) => {
  if (!row) return noData(resource);
  switch (resource.type) {
    case 'google_cloud_run_v2_service': case 'google_sql_database_instance': case 'google_container_cluster': case 'google_pubsub_topic':
    case 'google_spanner_instance': case 'google_storage_bucket': case 'google_redis_instance':
      return (row.samples ?? 0) === 0 ? noData(resource) : 'green';
    case 'google_bigquery_dataset':
    case 'google_cloudfunctions2_function':
      return (row.samples ?? 0) === 0 ? 'unknown' : 'green';
    case 'google_compute_instance': {
      if ((row.samples ?? 0) === 0) return resource.alwaysOn ? 'yellow' : 'unknown';
      const cpu = row.cpuUtil ?? null;
      if (cpu !== null && cpu > 0.9)  return 'red';
      if (cpu !== null && cpu > 0.75) return 'yellow';
      return 'green';
    }
    case 'gcp_billing': return 'unknown';
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
      if ((row.samples ?? 0) === 0) return 'unknown';
      const sf  = typeof row.statusCheckFailed   === 'number' ? row.statusCheckFailed   : 0;
      const if_ = typeof row.instanceCheckFailed === 'number' ? row.instanceCheckFailed : 0;
      const cpu = typeof row.cpuUsage            === 'number' ? row.cpuUsage            : null;
      if (sf > 0 || if_ > 0) return 'red';
      if (cpu !== null && cpu > 90) return 'red';
      if (cpu !== null && cpu > 75) return 'yellow';
      return 'green';
    }
    case 'aws_ecs':    return (row.samples ?? 0) === 0 ? 'yellow' : 'green';
    case 'aws_lambda': {
      if ((row.samples ?? 0) === 0) return 'unknown';
      const errs = row.errors ?? 0;
      return errs > 0 ? 'yellow' : 'green';
    }
    case 'aws_s3':     return (row.samples ?? 0) === 0 ? 'unknown' : 'green';
    case 'aws_billing': return (row.samples ?? 0) === 0 ? 'unknown' : 'green';
    default: return (row.samples ?? 0) === 0 ? noData(resource) : 'green';
  }
};

const deriveResourceReason = (resource, row, status) => {
  if (status === 'green' || status === 'unknown' || !row) return null;
  switch (resource.type) {
    case 'google_sql_database_instance':  return null;
    case 'google_compute_instance': {
      if ((row.samples ?? 0) === 0) return null;
      const cpu = row.cpuUtil ?? null;
      if (cpu !== null && cpu > 0.75) return `CPU usage: ${(cpu * 100).toFixed(1)}%${cpu > 0.9 ? ' (critical)' : ''}`;
      return null;
    }
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
      if (s === 0) return null;
      const parts = [];
      if (e5 !== null && e5 > 2)  parts.push(`5xx error rate: ${e5.toFixed(1)}%${e5 > 5 ? ' (critical)' : ''}`);
      if (ea !== null && ea > 15) parts.push(`Total error rate: ${ea.toFixed(1)}% (incl. 4xx)`);
      return parts.join(' · ') || null;
    }
    case 'aws_ec2': {
      const sf  = typeof row.statusCheckFailed   === 'number' ? row.statusCheckFailed   : 0;
      const if_ = typeof row.instanceCheckFailed === 'number' ? row.instanceCheckFailed : 0;
      const cpu = typeof row.cpuUsage            === 'number' ? row.cpuUsage            : null;
      const s   = row.samples ?? 0;
      if (s === 0) return null;
      const parts = [];
      if (sf > 0)  parts.push('System status check failed');
      if (if_ > 0) parts.push('Instance status check failed');
      if (cpu !== null && cpu > 75) parts.push(`CPU usage: ${cpu.toFixed(1)}%${cpu > 90 ? ' (critical)' : ''}`);
      return parts.join(' · ') || null;
    }
    case 'google_cloud_run_v2_service': return 'No billable instance time — all revisions may be scaled to zero';
    case 'google_container_cluster':    return null;
    case 'aws_ecs':  return null;
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
const billingCostToStatus   = (cost) => { if (cost === null) return 'unknown'; const pct = (cost/BILLING_BUDGET_INR)*100; return pct>=70?'red':pct>=50?'yellow':'green'; };
const estimatedCostToStatus = (est)  => { if (est  === null) return 'unknown'; const pct = (est/BILLING_BUDGET_INR)*100;  return pct>=100?'red':pct>=85?'yellow':'green'; };

const GhostResourceRow = ({ resource, hasToken = false }) => (
  <div style={{
    display:'flex', alignItems:'center', gap:10, padding:'7px 12px',
    borderRadius:8,
    background:'rgba(122,138,170,0.08)',
    border:'1px dashed rgba(122,138,170,0.35)',
  }}>
    <span style={{
      width:10, height:10, borderRadius:'50%', flexShrink:0,
      background:'transparent',
      border:'2px dashed #4a5a7a',
    }} />
    <div style={{ flex:1, minWidth:0 }}>
      <span style={{ fontWeight:600, fontSize:'0.82rem', color:'#8899bb', display:'block' }}>{resource.label}</span>
      {resource.desc && (
        <span style={{ fontSize:'0.72rem', color:'#5a6888', marginTop:2, lineHeight:1.4, display:'block' }}>
          {resource.desc}
        </span>
      )}
    </div>
    {hasToken ? (
      <span style={{
        fontSize:11, fontWeight:700,
        color:'#5a9aee',
        background:'rgba(66,133,244,0.12)',
        border:'1px solid rgba(66,133,244,0.30)',
        borderRadius:100,
        padding:'1px 8px',
        letterSpacing:'0.3px',
        whiteSpace:'nowrap',
        flexShrink:0,
      }}>not provisioned</span>
    ) : (
      <span style={{
        fontSize:11, fontWeight:700,
        color:'#5a6888',
        background:'rgba(90,104,136,0.15)',
        border:'1px solid rgba(90,104,136,0.3)',
        borderRadius:100,
        padding:'1px 8px',
        letterSpacing:'0.3px',
        whiteSpace:'nowrap',
        flexShrink:0,
      }}>no infra yet</span>
    )}
  </div>
);

// ─── Billing components ───────────────────────────────────────────────────────
const BillingHealthBadge = ({ cost }) => {
  if (cost === null) return <span className="status-badge status-badge--grey"><span className="status-badge__dot" />Billing</span>;
  const pct = (cost/BILLING_BUDGET_INR)*100, status = billingCostToStatus(cost);
  return (
    <span className={`status-badge status-badge--${status} status-badge--billing`} title={`${pct.toFixed(1)}% of monthly budget`}>
      <span className="status-badge__dot" />
      <span className="status-badge__billing-current">{'₹'+cost.toFixed(0)}</span>
      <span className="status-badge__billing-sep">/</span>
      <span className="status-badge__billing-budget">{'₹'+BILLING_BUDGET_INR+' budget'}</span>
    </span>
  );
};

const StatusDot   = ({ status }) => { const cls=(status==='unknown'||status==='deleted'||status==='empty')?'grey':status; return <span className={`status-dot status-dot--${cls}`} />; };
const StatusBadge = ({ status, label }) => { const meta=STATUS_META[status]??STATUS_META.green; const cls=(status==='unknown'||status==='deleted'||status==='empty')?'grey':status; return <span className={`status-badge status-badge--${cls}`}><span className="status-badge__dot" />{label??meta.label}</span>; };

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

const NoInfraBadge = ({ checking = false }) => {
  if (checking) return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10, color:'#4a6080', fontWeight:500 }}>
      <SpinnerIcon size={9} color="#4a6080" /><span>checking…</span>
    </span>
  );
  return (
    <span style={{ fontSize:10, fontWeight:700, color:'#7a8aaa', background:'rgba(122,138,170,0.10)', border:'1px solid rgba(122,138,170,0.28)', borderRadius:100, padding:'2px 9px', textTransform:'uppercase', letterSpacing:'0.5px', flexShrink:0 }}>
      No Infra Yet
    </span>
  );
};

// ─── Config modal ─────────────────────────────────────────────────────────────
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
            <input type={show?'text':'password'} value={tokenInput} onChange={e=>setTokenInput(e.target.value)} placeholder="github_pat_XXXX…"
              style={{ width:'100%', background:'#0d1525', border:'1px solid rgba(255,255,255,0.18)', borderRadius:8, padding:'9px 40px 9px 12px', color:'#f0f4ff', fontSize:13, outline:'none', boxSizing:'border-box', fontFamily:'monospace', colorScheme:'dark' }}
            />
            <button onClick={()=>setShow(s=>!s)} style={{ position:'absolute', right:10, background:'none', border:'none', cursor:'pointer', color:'#7a8aaa', fontSize:13, padding:0, outline:'none' }}>{show?'🙈':'👁'}</button>
          </div>
          {tokenInput && (
            <div style={{ marginTop:5, fontSize:10, color:'#4a6080' }}>
              {tokenInput.startsWith('github_pat_')||tokenInput.startsWith('ghp_')
                ?<span style={{ color:'#00d4aa' }}>✓ Looks like a valid GitHub token</span>
                :<span style={{ color:'#f5a623' }}>⚠ Expected: starts with github_pat_ or ghp_</span>}
            </div>
          )}
        </div>
        {error && <div style={{ fontSize:12, color:'#ff4d6d', marginBottom:14, padding:'8px 12px', background:'rgba(255,77,109,0.08)', borderRadius:6, border:'1px solid rgba(255,77,109,0.2)' }}>⚠ {error}</div>}
        {saved  && <div style={{ fontSize:12, color:'#00d4aa', marginBottom:14, padding:'8px 12px', background:'rgba(0,212,170,0.08)', borderRadius:6, border:'1px solid rgba(0,212,170,0.2)' }}>✓ Token saved!</div>}
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={{ padding:'8px 18px', borderRadius:8, border:'1px solid rgba(255,255,255,0.15)', background:'transparent', color:'#7a8aaa', fontWeight:600, fontSize:13, cursor:'pointer', outline:'none', boxShadow:'none', WebkitAppearance:'none', appearance:'none' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding:'8px 22px', borderRadius:8, border:'none', background:'#4285f4', color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer', outline:'none', opacity:saving?0.65:1 }}>{saving?'Saving…':'Save Token'}</button>
        </div>
      </div>
    </div>
  );
};

// ─── Infra UI components ───────────────────────────────────────────────────────
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

const InfraConfirmModal = ({ project, action, ghToken, onConfirm, onCancel }) => {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const isStop = action==='stop', isStart=action==='start', isApply=action==='apply', isTerminate=action==='terminate';

  const handleConfirm = async () => {
    setBusy(true); setErr('');
    try {
      const ghAction = isApply?'apply':isStop?'stop':isStart?'start':'destroy';
      const preDispatch = Date.now();
      await callInfraAPI(project, ghAction, ghToken);
      onConfirm(preDispatch);
    } catch (e) { setErr(e?.message||'GitHub Actions dispatch failed.'); setBusy(false); }
  };

  const colors = isApply?{bg:'rgba(66,133,244,0.12)',border:'rgba(66,133,244,0.4)',text:'#4285f4'}
    :isTerminate?{bg:'rgba(255,77,109,0.12)',border:'rgba(255,77,109,0.4)',text:'#ff4d6d'}
    :isStart?{bg:'rgba(0,212,170,0.12)',border:'rgba(0,212,170,0.4)',text:'#00d4aa'}
    :{bg:'rgba(245,166,35,0.12)',border:'rgba(245,166,35,0.4)',text:'#f5a623'};

  const title   = isApply?'Apply Infrastructure?':isTerminate?'Terminate Infrastructure?':isStart?'Start Infrastructure?':'Stop Infrastructure?';
  const btnText = busy?'Dispatching…':isApply?'Yes, apply it':isTerminate?'Yes, terminate':isStart?'Yes, start it':'Yes, stop it';
  const projectPath = `projects/${project.projectDirName}`;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(8,11,20,0.92)', backdropFilter:'blur(10px)', zIndex:10000, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onCancel}>
      <div style={{ background:'#0f1629', border:`1px solid ${colors.border}`, borderRadius:16, width:'90%', maxWidth:440, padding:'28px 28px 22px', boxShadow:'0 32px 100px rgba(0,0,0,0.8)' }} onClick={e=>e.stopPropagation()}>
        <div style={{ width:48, height:48, borderRadius:12, background:colors.bg, border:`1px solid ${colors.border}`, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:16 }}>
          {isTerminate?<PowerOffIcon size={22} color={colors.text} />:<span style={{ fontSize:22 }}>{isApply?'⚙':isStart?'▶':'⏸'}</span>}
        </div>
        <div style={{ fontSize:17, fontWeight:800, color:'#f0f4ff', marginBottom:8 }}>{title}</div>
        <div style={{ fontSize:13, color:'#7a8aaa', lineHeight:1.6, marginBottom:20 }}>
          {isApply&&<>Run <span style={{ fontFamily:'monospace', color:colors.text, fontWeight:700 }}>terraform apply</span> on <strong style={{ color:'#f0f4ff' }}>{project.name}</strong>. Resources will be <strong style={{ color:colors.text }}>provisioned or updated</strong>.</>}
          {isStop&&<>Scale down all services for <strong style={{ color:'#f0f4ff' }}>{project.name}</strong> via CLI.</>}
          {isStart&&<>Scale up all services for <strong style={{ color:'#f0f4ff' }}>{project.name}</strong> via CLI.</>}
          {isTerminate&&<><span style={{ fontFamily:'monospace', color:colors.text, fontWeight:700 }}>terraform destroy</span> on <strong style={{ color:'#f0f4ff' }}>{project.name}</strong>. All resources will be <strong style={{ color:colors.text }}>permanently destroyed</strong>.<div style={{ marginTop:10, padding:'8px 12px', background:'rgba(255,77,109,0.07)', border:'1px solid rgba(255,77,109,0.2)', borderRadius:8, fontSize:12, color:'#ff4d6d' }}>⚠ Use Apply to re-provision after termination.</div></>}
        </div>
        <div style={{ fontSize:12, color:'#4a6080', marginBottom:14, padding:'8px 12px', background:'rgba(255,255,255,0.03)', borderRadius:6, border:'1px solid rgba(255,255,255,0.07)' }}>
          🔗 <strong style={{ color:'#c8d4f0' }}>{GH_OWNER}/{GH_REPO}</strong>
          <div style={{ marginTop:3, fontSize:11, color:'#3d5070' }}>Path: <code style={{ color:'#7a9aaa' }}>{projectPath}</code></div>
        </div>
        {!ghToken&&<div style={{ fontSize:12, color:'#f5a623', marginBottom:14, padding:'8px 12px', background:'rgba(245,166,35,0.08)', borderRadius:6, border:'1px solid rgba(245,166,35,0.25)' }}>⚠ ACCESS_TOKEN not set — use ⚙ Config to add it first.</div>}
        {err&&<div style={{ fontSize:12, color:'#ff4d6d', marginBottom:14, padding:'8px 12px', background:'rgba(255,77,109,0.08)', borderRadius:6, border:'1px solid rgba(255,77,109,0.2)' }}>⚠ {err}</div>}
        <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button onClick={onCancel} disabled={busy} style={{ padding:'8px 18px', borderRadius:8, border:'1px solid rgba(255,255,255,0.15)', background:'transparent', color:'#7a8aaa', fontWeight:600, fontSize:13, cursor:'pointer', outline:'none', boxShadow:'none', WebkitAppearance:'none', appearance:'none' }}>Cancel</button>
          <button onClick={handleConfirm} disabled={busy||!ghToken} style={{ padding:'8px 20px', borderRadius:8, border:'none', background:colors.text, color:'#fff', fontWeight:700, fontSize:13, cursor:busy||!ghToken?'not-allowed':'pointer', outline:'none', opacity:busy||!ghToken?0.5:1 }}>{btnText}</button>
        </div>
      </div>
    </div>
  );
};

const InfraActionButtons = ({ project, lifecycle, actionState, activeAction, infraReady, tfLoading, ghToken, onAction }) => {
  const isBusy = actionState===INFRA_STATES.DISPATCHING||actionState===INFRA_STATES.RUNNING;
  const getButtonState = (action) => {
    if (!infraReady) return 'disabled';
    if (isBusy) return action===activeAction?'running':'locked';
    if (!lifecycle) return action==='apply'?'enabled':'disabled';
    const allowed = ALLOWED_ACTIONS[lifecycle]||[];
    return allowed.includes(action)?'enabled':'disabled';
  };
  const btnDef = [
    { action:'apply',     label:'Apply',     icon:<GearIcon size={12} color="currentColor" />,     colors:{bg:'#162d52',border:'#4285f4',text:'#7ab3ff',disabledBg:'#0d1a2e',disabledBorder:'#1e3050',disabledText:'#3a5580'} },
    { action:'stop',      label:'Stop',      icon:<StopIcon size={12} color="currentColor" />,      colors:{bg:'#2e1f00',border:'#f5a623',text:'#ffc055',disabledBg:'#1a1200',disabledBorder:'#3d2a00',disabledText:'#5a4010'} },
    { action:'start',     label:'Start',     icon:<PlayIcon size={12} color="currentColor" />,      colors:{bg:'#002e22',border:'#00d4aa',text:'#00ffcc',disabledBg:'#001a14',disabledBorder:'#003d2e',disabledText:'#105040'} },
    { action:'terminate', label:'Terminate', icon:<PowerOffIcon size={12} color="currentColor" />, colors:{bg:'#2e0010',border:'#ff4d6d',text:'#ff7a96',disabledBg:'#1a000a',disabledBorder:'#3d0015',disabledText:'#581030'} },
  ];
  return (
    <div style={{ margin:'8px 0 4px', padding:'10px 12px', background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8 }}>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {btnDef.map(({ action, label, icon, colors:c }) => {
          const btnState = getButtonState(action);
          const isRunning  = btnState==='running';
          const isDisabled = btnState==='disabled'||btnState==='locked';
          return (
            <button key={action} onClick={() => !isDisabled&&!isRunning&&onAction(project,action)} disabled={isDisabled||isRunning}
              style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:7, border:`1px solid ${isDisabled?c.disabledBorder:c.border}`, background:isDisabled?c.disabledBg:c.bg, color:isDisabled?c.disabledText:c.text, fontWeight:700, fontSize:12, cursor:isDisabled||isRunning?'not-allowed':'pointer', outline:'none', transition:'all 0.15s', letterSpacing:'0.3px' }}
              onMouseEnter={e=>{if(!isDisabled&&!isRunning){e.currentTarget.style.filter='brightness(1.2)';e.currentTarget.style.transform='translateY(-1px)';}}}
              onMouseLeave={e=>{if(!isDisabled&&!isRunning){e.currentTarget.style.filter='brightness(1)';e.currentTarget.style.transform='translateY(0)';}}}
            >
              {isRunning?<SpinnerIcon size={12} color={c.text} />:<span style={{ display:'flex', alignItems:'center', color:isDisabled?c.disabledText:c.text }}>{icon}</span>}
              <span>{isRunning?`${label}ing…`:label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ─── EC2 helpers ───────────────────────────────────────────────────────────────
const extractFacetName = (series) => {
  const groups = series?.metadata?.groups;
  if (Array.isArray(groups)) { const g=groups.find(g=>g.type==='facet'); if (g?.value&&g.value!=='Other') return g.value; }
  const pt = series?.data?.[0];
  if (pt?.facet) return Array.isArray(pt.facet)?pt.facet[0]:String(pt.facet);
  const name = series?.metadata?.name;
  const SKIP = new Set(['val','Other','unknown','count','latest','FreeableMemory','WriteIOPS','WriteLatency','ReadIOPS','CPUUtilization']);
  if (name&&!SKIP.has(name)) return name;
  return null;
};

const extractEc2FacetPair = (series) => {
  let name = null;
  const groups = series?.metadata?.groups;
  if (Array.isArray(groups)) { const f=groups.filter(g=>g.type==='facet'); if (f.length>=1) name=f[0].value; }
  if (!name) { const pt=series?.data?.[0]; if (pt?.facet) name=Array.isArray(pt.facet)?pt.facet[0]:String(pt.facet); }
  if (!name) { const n=series?.metadata?.name; const SKIP=new Set(['val','Other','unknown','count','statusFailed','cpu']); if (n&&!SKIP.has(n)) name=n; }
  if (!name) return null;
  const pt=series?.data?.[0]; const sf=pt?.statusFailed??null;
  return { name, state:(sf===null||sf===undefined)?'stopped':sf>0?'impaired':'running' };
};

const Ec2CountLoader = ({ project, onCounts, loaded }) => {
  const pf = ec2ProjectFilter(project);
  const midQ   = `SELECT latest(\`aws.ec2.StatusCheckFailed\`) AS statusFailed FROM Metric WHERE aws.Namespace = 'AWS/EC2' AND ${pf} FACET \`aws.ec2.InstanceId\` SINCE 7 days ago LIMIT 50`;
  const innerQ = `SELECT latest(\`aws.ec2.StatusCheckFailed\`) AS statusFailed FROM Metric WHERE aws.Namespace = 'AWS/EC2' AND ${pf} FACET \`aws.ec2.InstanceId\` SINCE 10 minutes ago LIMIT 50`;
  return (
    <NrqlQuery accountIds={[ACCOUNT_ID]} query={midQ} pollInterval={60000}>
      {({ data:midData }) => (
        <NrqlQuery accountIds={[ACCOUNT_ID]} query={innerQ} pollInterval={60000}>
          {({ data:innerData }) => {
            if (!midData||!innerData) return null;
            const recentIds=new Set(), impairedIds=new Set();
            (innerData||[]).forEach(s=>{const p=extractEc2FacetPair(s);if(!p?.name)return;recentIds.add(p.name);if(p.state==='impaired')impairedIds.add(p.name);});
            const seen=new Set(); let run=0,stop=0,imp=0;
            (midData||[]).forEach(s=>{const p=extractEc2FacetPair(s);if(!p?.name||seen.has(p.name))return;seen.add(p.name);if(impairedIds.has(p.name))imp++;else if(recentIds.has(p.name))run++;else stop++;});
            if (!loaded) setTimeout(()=>onCounts({run,stop,imp}),0);
            return null;
          }}
        </NrqlQuery>
      )}
    </NrqlQuery>
  );
};

// ─── TF static name list renderer ─────────────────────────────────────────────
const TfNameList = ({ names, lifecycle, resourceType }) => {
  const isTerminated = lifecycle === 'terminated';
  const acC = resourceType.startsWith('aws') ? 'rgba(255,153,0,0.08)' : 'rgba(66,133,244,0.08)';
  const boC = resourceType.startsWith('aws') ? 'rgba(255,153,0,0.12)' : 'rgba(66,133,244,0.12)';
  const dotCls = isTerminated ? 'red' : 'yellow';
  const labelColor = isTerminated ? '#ff4d6d' : '#f5a623';
  const labelText  = isTerminated ? '✗ Terminated' : '✗ Stopped';
  return (
    <div style={{ margin:'0 8px 6px', background:acC, border:`1px solid ${boC}`, borderRadius:6, overflow:'hidden' }}>
      {names.map((name, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 10px', borderBottom:i<names.length-1?'1px solid rgba(255,255,255,0.04)':'none' }}>
          <span className={`status-dot status-dot--${dotCls}`} style={{ width:6, height:6, flexShrink:0 }} />
          <span style={{ fontSize:11, color:'#c8d4f0', fontFamily:'monospace', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
          <span style={{ fontSize:10, color:labelColor, fontWeight:600 }}>{labelText}</span>
        </div>
      ))}
    </div>
  );
};

// ─── ExpandableResourceRow ────────────────────────────────────────────────────
const ExpandableResourceRow = ({ resource:r, project, lifecycle, tfResources = {} }) => {
  const [open, setOpen] = React.useState(false);
  const [ec2Counts, setEc2Counts] = React.useState(null);
  const hasSubList = !!(SERVICE_QUERIES[r.type]);

  const displayStatus = (() => {
    if (lifecycle === 'terminated')  return 'red';
    if (lifecycle === 'stopped')     return 'yellow';
    if (lifecycle === 'provisioned' && r.status === 'unknown') return 'green';
    return r.status;
  })();

  const dotCls      = displayStatus==='green'?'green':displayStatus==='yellow'?'yellow':displayStatus==='red'?'red':'grey';
  const statusColor = displayStatus==='green'?'#00d4aa':displayStatus==='yellow'?'#f5a623':displayStatus==='red'?'#ff4d6d':'#7a8aaa';
  const isPaused    = canBePaused(r.type, r.row);

  const statusLabel = lifecycle === 'terminated'
    ? '✗ Terminated'
    : lifecycle === 'stopped'
      ? '✗ Stopped'
      : lifecycle === 'provisioned' && r.status === 'red'
        ? (r.alwaysOn ? '✗ Errors' : '✗ Stopped')
        : lifecycle === 'provisioned' && r.status === 'yellow'
          ? (isPaused ? '⊘ Paused' : '⚠ Warning')
          : lifecycle === 'provisioned' && (r.status === 'unknown' || r.status === 'green')
            ? '✓ Running'
            : displayStatus==='green'  ? '✓ Running'
            : displayStatus==='yellow' ? (isPaused?'⊘ Paused':r.alwaysOn?'⚠ Warning':'✗ Stopped')
            : displayStatus==='red'    ? (r.alwaysOn?'✗ Errors':'✗ Stopped')
            : '— No Data';

  const query = hasSubList?(typeof SERVICE_QUERIES[r.type]==='function'?SERVICE_QUERIES[r.type](project):null):null;
  const useTfNames = (lifecycle === 'stopped' || lifecycle === 'terminated') && tfResources[r.type]?.length > 0;

  return (
    <div style={{ borderRadius:6, overflow:'hidden', background:'rgba(255,255,255,0.03)' }}>
      {r.type==='aws_ec2' && <Ec2CountLoader project={project} onCounts={setEc2Counts} loaded={!!ec2Counts} />}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 8px', cursor:hasSubList?'pointer':'default' }} onClick={()=>hasSubList&&setOpen(o=>!o)}>
        <span className={'status-dot status-dot--'+dotCls} style={{ flexShrink:0, alignSelf:'flex-start', marginTop:3 }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            <span style={{ fontWeight:600, fontSize:'0.8rem', color:'#f0f4ff' }}>{r.label}</span>
            {r.type==='aws_ec2'&&ec2Counts&&lifecycle!=='stopped'&&lifecycle!=='terminated'&&(
              <span style={{ fontSize:10, fontWeight:700 }}>
                {ec2Counts.run>0&&<span style={{ color:'#00d4aa' }}>{ec2Counts.run} running</span>}
                {ec2Counts.run>0&&ec2Counts.stop>0&&<span style={{ color:'#7a8aaa' }}> · </span>}
                {ec2Counts.stop>0&&<span style={{ color:'#f5a623' }}>{ec2Counts.stop} stopped</span>}
                {(ec2Counts.run>0||ec2Counts.stop>0)&&ec2Counts.imp>0&&<span style={{ color:'#7a8aaa' }}> · </span>}
                {ec2Counts.imp>0&&<span style={{ color:'#ff4d6d' }}>{ec2Counts.imp} impaired</span>}
              </span>
            )}
            {useTfNames&&(
              <span style={{ fontSize:10, color:'#4a5a7a', fontWeight:600 }}>
                {tfResources[r.type].length} resource{tfResources[r.type].length!==1?'s':''}
              </span>
            )}
          </div>
          {r.reason&&<div style={{ fontSize:'0.75rem', color:statusColor, marginTop:3, lineHeight:1.5, fontWeight:500 }}>{r.reason}</div>}
        </div>
        <span style={{ color:statusColor, fontSize:'0.75rem', fontWeight:600, flexShrink:0 }}>{statusLabel}</span>
        {hasSubList&&<span style={{ fontSize:14, color:'#3d4a66', transition:'transform 0.2s', display:'inline-block', transform:open?'rotate(90deg)':'rotate(0deg)', flexShrink:0 }}>›</span>}
      </div>

      {open && (
        useTfNames ? (
          <TfNameList names={tfResources[r.type]} lifecycle={lifecycle} resourceType={r.type} />
        ) : query ? (
          <NrqlQuery accountIds={[ACCOUNT_ID]} query={query} pollInterval={60000}>
            {({ data, loading }) => {
              if (loading) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa', fontStyle:'italic' }}>Loading…</div>;
              if (!data||data.length===0) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa' }}>No instances found</div>;
              const acC=r.type.startsWith('aws')?'rgba(255,153,0,0.08)':'rgba(66,133,244,0.08)';
              const boC=r.type.startsWith('aws')?'rgba(255,153,0,0.12)':'rgba(66,133,244,0.12)';

              if (r.type==='google_cloud_run_v2_service') {
                const aq=`SELECT sum(container.BillableInstanceTime) AS billableTime FROM GcpRunRevisionSample WHERE projectId = '${project.gcpProjectId}' FACET serviceName SINCE 30 minutes ago LIMIT 100`;
                return (
                  <NrqlQuery accountIds={[ACCOUNT_ID]} query={aq} pollInterval={60000}>
                    {({ data:ad, loading:al }) => {
                      if (al) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa', fontStyle:'italic' }}>Loading…</div>;
                      const activeServices=new Set();
                      (ad||[]).forEach(series=>{
                        let name=null; const g=series?.metadata?.groups;
                        if (Array.isArray(g)){const f=g.find(x=>x.type==='facet');if(f?.value)name=f.value;}
                        if (!name){const pt=series?.data?.[0];if(pt?.facet)name=Array.isArray(pt.facet)?pt.facet[0]:String(pt.facet);}
                        if (!name) name=series?.metadata?.name;
                        const b=series?.data?.[0]?.y??0; if (name&&b>0) activeServices.add(name);
                      });
                      const seen=new Set(), NONSVC=new Set(['val','Other','unknown','count','latest']);
                      const allServices=data.map(series=>{
                        let name=null; const g=series?.metadata?.groups;
                        if (Array.isArray(g)){const f=g.find(x=>x.type==='facet');if(f?.value)name=f.value;}
                        if (!name){const pt=series?.data?.[0];if(pt?.facet)name=Array.isArray(pt.facet)?pt.facet[0]:String(pt.facet);}
                        if (!name) name=series?.metadata?.name;
                        if (!name||NONSVC.has(name)||seen.has(name)) return null;
                        seen.add(name); return name;
                      }).filter(Boolean);
                      (project.knownServices||[]).forEach(s=>{if(!seen.has(s)){seen.add(s);allServices.push(s);}});
                      if (allServices.length===0) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa' }}>No services found</div>;
                      allServices.sort((a,b)=>{const aA=activeServices.has(a),bA=activeServices.has(b);if(aA!==bA)return bA?1:-1;return a.localeCompare(b);});
                      return (
                        <div style={{ margin:'0 8px 6px', background:acC, border:`1px solid ${boC}`, borderRadius:6, overflow:'hidden' }}>
                          {allServices.map((name,i)=>(
                            <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 10px', borderBottom:i<allServices.length-1?'1px solid rgba(255,255,255,0.04)':'none' }}>
                              <span className="status-dot status-dot--green" style={{ width:6,height:6,flexShrink:0 }} />
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

              if (r.type==='aws_ec2') {
                const pf=ec2ProjectFilter(project);
                const aq=`SELECT latest(\`aws.ec2.StatusCheckFailed\`) AS statusFailed FROM Metric WHERE aws.Namespace = 'AWS/EC2' AND ${pf} FACET \`aws.ec2.InstanceId\` SINCE 10 minutes ago LIMIT 50`;
                const mq=`SELECT latest(\`aws.ec2.StatusCheckFailed\`) AS statusFailed FROM Metric WHERE aws.Namespace = 'AWS/EC2' AND ${pf} FACET \`aws.ec2.InstanceId\` SINCE 7 days ago LIMIT 50`;
                return (
                  <NrqlQuery accountIds={[ACCOUNT_ID]} query={aq} pollInterval={60000}>
                    {({ data:ad, loading:al }) => (
                      <NrqlQuery accountIds={[ACCOUNT_ID]} query={mq} pollInterval={60000}>
                        {({ data:md, loading:ml }) => {
                          if (al||ml) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa', fontStyle:'italic' }}>Loading…</div>;
                          const activeI=new Set(), impairedI=new Set();
                          (ad||[]).forEach(s=>{const p=extractEc2FacetPair(s);if(!p?.name)return;activeI.add(p.name);if(p.state==='impaired')impairedI.add(p.name);});
                          const seen=new Set(), visibleInstances=[];
                          (md||[]).forEach(s=>{const p=extractEc2FacetPair(s);if(!p?.name||seen.has(p.name))return;seen.add(p.name);visibleInstances.push({name:p.name,state:impairedI.has(p.name)?'impaired':activeI.has(p.name)?'running':'stopped'});});
                          if (visibleInstances.length===0) return (
                            <div style={{ padding:'8px 12px 6px', fontSize:11, color:'#7a8aaa', fontStyle:'italic' }}>
                              No instances found in last 7 days
                            </div>
                          );
                          const ord={running:0,pending:1,stopping:2,stopped:3,impaired:4};
                          visibleInstances.sort((a,b)=>{const ao=ord[a.state]??99,bo=ord[b.state]??99;return ao!==bo?ao-bo:a.name.localeCompare(b.name);});
                          return (
                            <div style={{ margin:'0 8px 6px', background:acC, border:`1px solid ${boC}`, borderRadius:6, overflow:'hidden' }}>
                              {visibleInstances.map((inst,i)=>{const d=ec2StateDisplay(inst.state);return(
                                <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 10px', borderBottom:i<visibleInstances.length-1?'1px solid rgba(255,255,255,0.04)':'none' }}>
                                  <span className={'status-dot status-dot--'+d.dot} style={{ width:6,height:6,flexShrink:0 }} />
                                  <span style={{ fontSize:11, color:'#c8d4f0', fontFamily:'monospace', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{inst.name}</span>
                                  <span style={{ fontSize:10, color:d.color, fontWeight:600 }}>{d.label}</span>
                                </div>
                              );})}
                            </div>
                          );
                        }}
                      </NrqlQuery>
                    )}
                  </NrqlQuery>
                );
              }

              if (r.type==='aws_apprunner') {
                const aq="SELECT max(`aws.apprunner.ActiveInstances`) AS activeInstances FROM Metric WHERE aws.Namespace = 'AWS/AppRunner' FACET aws.apprunner.ServiceName SINCE 5 minutes ago LIMIT 30";
                return (
                  <NrqlQuery accountIds={[ACCOUNT_ID]} query={aq} pollInterval={60000}>
                    {({ data:ad, loading:al }) => {
                      if (al) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa', fontStyle:'italic' }}>Loading…</div>;
                      const activeMap={};
                      (ad||[]).forEach(series=>{
                        let name=null; const g=series?.metadata?.groups;
                        if (Array.isArray(g)){const f=g.find(x=>x.type==='facet');if(f?.value)name=f.value;}
                        if (!name){const pt=series?.data?.[0];if(pt?.facet)name=Array.isArray(pt.facet)?pt.facet[0]:String(pt.facet);}
                        if (!name) return;
                        const pt=series?.data?.[0]; const ai=pt?.activeInstances??pt?.y??null;
                        if (name&&ai!==null) activeMap[name]=ai;
                      });
                      const seen=new Set(), NONSVC=new Set(['val','Other','unknown','count','activeInstances']);
                      const services=data.map(series=>{
                        let name=null; const g=series?.metadata?.groups;
                        if (Array.isArray(g)){const f=g.find(x=>x.type==='facet');if(f?.value)name=f.value;}
                        if (!name){const pt=series?.data?.[0];if(pt?.facet)name=Array.isArray(pt.facet)?pt.facet[0]:String(pt.facet);}
                        if (!name) name=series?.metadata?.name;
                        if (!name||NONSVC.has(name)||seen.has(name)) return null;
                        seen.add(name); return name;
                      }).filter(Boolean);
                      if (services.length===0) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa' }}>No services found</div>;
                      services.sort((a,b)=>{const aA=activeMap[a]??null,bA=activeMap[b]??null;if(aA!==null&&bA===null)return -1;if(bA!==null&&aA===null)return 1;if((aA??0)>0&&(bA??0)===0)return -1;if((bA??0)>0&&(aA??0)===0)return 1;return a.localeCompare(b);});
                      return (
                        <div style={{ margin:'0 8px 6px', background:acC, border:`1px solid ${boC}`, borderRadius:6, overflow:'hidden' }}>
                          {services.map((name,i)=>{
                            const ai=activeMap[name]??null, sDot=ai===null?'grey':ai>0?'green':'yellow', sLabel=ai===null?'— Unknown':ai>0?'✓ Running':'⊘ Paused', sColor=ai===null?'#7a8aaa':ai>0?'#00d4aa':'#f5a623';
                            return(
                              <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 10px', borderBottom:i<services.length-1?'1px solid rgba(255,255,255,0.04)':'none' }}>
                                <span className={'status-dot status-dot--'+sDot} style={{ width:6,height:6,flexShrink:0 }} />
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

              // Generic fallback
              const seen=new Set();
              const items=data.map(s=>{const n=extractFacetName(s);if(!n||seen.has(n))return null;seen.add(n);return n;}).filter(Boolean);
              if (items.length===0) return <div style={{ padding:'4px 12px 6px', fontSize:11, color:'#7a8aaa' }}>No instances found</div>;
              const iD=r.status==='green'?'green':r.status==='red'?'red':'yellow';
              const iL=r.status==='green'?'✓ Active':r.status==='red'?'✗ Errors':'⚠ Warning';
              const iC=r.status==='green'?'#00d4aa':r.status==='red'?'#ff4d6d':'#f5a623';
              return (
                <div style={{ margin:'0 8px 6px', background:acC, border:`1px solid ${boC}`, borderRadius:6, overflow:'hidden' }}>
                  {items.map((name,i)=>(
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 10px', borderBottom:i<items.length-1?'1px solid rgba(255,255,255,0.04)':'none' }}>
                      <span className={'status-dot status-dot--'+iD} style={{ width:6,height:6,flexShrink:0 }} />
                      <span style={{ fontSize:11, color:'#c8d4f0', fontFamily:'monospace', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
                      <span style={{ fontSize:10, color:iC, fontWeight:600 }}>{iL}</span>
                    </div>
                  ))}
                </div>
              );
            }}
          </NrqlQuery>
        ) : null
      )}
    </div>
  );
};

// ─── Billing display ───────────────────────────────────────────────────────────
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

// ─── Project manager modal ─────────────────────────────────────────────────────
const ProjectManagerModal = ({ providers, providerId, projectHealthMap, onSave, onClose }) => {
  const [view,          setView]          = useState('list');
  const [form,          setForm]          = useState({ providerId, name:'', gcpProjectId:'', dashboardGuid:'', dashboardLink:'', projectDirName:'', projectType:'normal', selectedResources:[], knownServices:'', customResources:'' });
  const [editInfo,      setEditInfo]      = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [saveError,     setSaveError]     = useState('');

  const provider    = providers.find(p=>p.id===providerId);
  const pi          = providers.findIndex(p=>p.id===providerId);
  const accentColor = providerId==='gcp'?'#4285f4':'#FF9900';
  const setField    = (k,v) => setForm(f=>({...f,[k]:v}));

  const startEdit = (pj) => {
    const project = provider.projects[pj];
    let projectType = 'normal';
    if (project.empty) projectType='empty';
    else if (project.billingNotConfigured||project.billingOnly) projectType='billing';
    const knownTypes = new Set((RESOURCE_OPTIONS[providerId]||[]).map(o=>o.type));
    const customRes  = (project.resources||[]).filter(r=>!knownTypes.has(r.type)).map(r=>r.label).join(', ');
    setForm({ providerId, name:project.name||'', gcpProjectId:project.gcpProjectId||'', dashboardGuid:project.dashboardGuid||'', dashboardLink:project.dashboardLink||'', projectDirName:project.projectDirName||'', projectType, selectedResources:(project.resources||[]).map(r=>r.type).filter(t=>knownTypes.has(t)), knownServices:(project.knownServices||[]).join(', '), customResources:customRes });
    setEditInfo({ pi, pj }); setSaveError(''); setView('form');
  };

  const buildProject = () => {
    const { name, gcpProjectId, dashboardGuid, dashboardLink, projectDirName, projectType, selectedResources, knownServices, customResources } = form;
    const base = { name:name.trim(), gcpProjectId:gcpProjectId.trim()||null, dashboardGuid:dashboardGuid.trim()||null, dashboardLink:dashboardLink.trim()||null, projectDirName:projectDirName.trim()||null };
    if (projectType==='empty') return { ...base, empty:true, resources:[] };
    if (projectType==='billing') return { ...base, billingOnly:true, resources:[{ label:'Total Cost (INR)', type:providerId==='aws'?'aws_billing':'gcp_billing', alwaysOn:false }] };
    const allOpts      = RESOURCE_OPTIONS[providerId]||[];
    const stdResources = allOpts.filter(o=>selectedResources.includes(o.type)).map(o=>({...o}));
    const customParsed = (customResources||'').split(',').map(s=>s.trim()).filter(Boolean).map(label=>({ label, type:'custom_'+label.toLowerCase().replace(/[^a-z0-9]/g,'_'), alwaysOn:false }));
    const resources    = [...stdResources, ...customParsed];
    const project      = { ...base, resources };
    if (selectedResources.includes('google_cloud_run_v2_service')&&knownServices.trim())
      project.knownServices=knownServices.split(',').map(s=>s.trim()).filter(Boolean);
    return project;
  };

  const handleSubmit = async () => {
    setSaveError('');
    if (!form.name.trim()) { setSaveError('Project name is required.'); return; }
    setSaving(true);
    try {
      const newProviders = providers.map(p=>({...p,projects:[...p.projects]}));
      const project = buildProject();
      if (editInfo) { newProviders[pi].projects[editInfo.pj]=project; }
      else          { newProviders[pi].projects.push(project); }
      await onSave(newProviders);
      onClose();
    } catch (e) { setSaveError(e?.message||'Save failed. Please try again.'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (pj) => {
    setSaveError('');
    try { const np=providers.map(p=>({...p,projects:[...p.projects]})); np[pi].projects.splice(pj,1); await onSave(np); setDeleteConfirm(null); }
    catch (e) { setSaveError(e?.message||'Delete failed.'); }
  };

  const handleArchive = async (pj) => {
    setSaveError('');
    try {
      const np=providers.map(p=>({...p,projects:[...p.projects]}));
      const proj={...np[pi].projects[pj],deleted:true,resources:[]};
      delete proj.billingOnly; delete proj.billingNotConfigured; delete proj.empty;
      np[pi].projects[pj]=proj; await onSave(np);
    } catch (e) { setSaveError(e?.message||'Archive failed.'); }
  };

  const handleUnarchive = async (pj) => {
    setSaveError('');
    try { const np=providers.map(p=>({...p,projects:[...p.projects]})); const proj={...np[pi].projects[pj]}; delete proj.deleted; np[pi].projects[pj]=proj; await onSave(np); }
    catch (e) { setSaveError(e?.message||'Unarchive failed.'); }
  };

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

  if (view==='list') return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.panel} onClick={e=>e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
              <span style={{ fontSize:18 }}>{provider?.icon}</span>
              <div style={{ fontSize:19, fontWeight:800, color:accentColor }}>{provider?.name} Projects</div>
            </div>
            <div style={{ fontSize:12, color:'#7a8aaa', marginTop:3 }}>Manage {provider?.label} projects</div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={()=>{setEditInfo(null);setForm({providerId,name:'',gcpProjectId:'',dashboardGuid:'',dashboardLink:'',projectDirName:'',projectType:'normal',selectedResources:[],knownServices:'',customResources:''});setSaveError('');setView('form');}} style={{ ...s.btnPrimary, background:accentColor, padding:'7px 14px', fontSize:12 }}>+ Add Project</button>
            <button onClick={onClose} style={{ ...s.btnSecondary, padding:'7px 14px', fontSize:12 }}>✕</button>
          </div>
        </div>
        <div style={s.body}>
          {!provider||provider.projects.length===0?(
            <div style={{ color:'#3d4a66', fontSize:12, fontStyle:'italic', padding:'8px 0' }}>No projects configured yet. Click "+ Add Project" to get started.</div>
          ):(
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {provider.projects.map((project,pj)=>{
                const typeTag  = project.deleted?'Archived':project.empty?'No Monitoring':project.billingNotConfigured?'Billing N/A':project.billingOnly?'Billing':null;
                const key      = `${pi}-${pj}`;
                const tagColor = project.deleted?'#4a5568':project.billingNotConfigured?'#4285f4':'#7a8aaa';
                const tagBg    = project.deleted?'rgba(74,85,104,0.15)':project.billingNotConfigured?'rgba(66,133,244,0.12)':'rgba(255,255,255,0.06)';
                const health   = projectHealthMap?.[project.name]??'unknown';
                const dotColor = project.deleted?'#4a5568':health==='green'?'#00d4aa':health==='yellow'?'#f5a623':health==='red'?'#ff4d6d':'#7a8aaa';
                return (
                  <div key={project.projectDirName||project.name} style={{ display:'flex', alignItems:'center', gap:8, padding:'11px 14px', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10 }}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.055)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,0.03)'}>
                    <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0, background:dotColor }} />
                    <span style={{ flex:1, fontSize:13, fontWeight:600, color:'#c8d4f0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{project.name}</span>
                    {project.projectDirName&&<span style={{ fontSize:10, color:'#3d5070', fontFamily:'monospace', flexShrink:0 }}>{project.projectDirName}</span>}
                    {typeTag&&<span style={{ fontSize:10, fontWeight:700, color:tagColor, background:tagBg, borderRadius:100, padding:'2px 8px', textTransform:'uppercase', letterSpacing:0.5, flexShrink:0, border:`1px solid ${tagColor}44` }}>{typeTag}</span>}
                    {!typeTag&&project.resources?.length>0&&<span style={{ fontSize:11, color:'#4a5568', flexShrink:0 }}>{project.resources.length} resource{project.resources.length!==1?'s':''}</span>}
                    <button onClick={()=>startEdit(pj)} style={{ padding:'5px 12px', borderRadius:6, border:'1px solid rgba(200,212,240,0.4)', background:'rgba(200,212,240,0.1)', color:'#c8d4f0', fontWeight:600, fontSize:12, cursor:'pointer', flexShrink:0, outline:'none' }}>Edit</button>
                    {project.deleted
                      ?<button onClick={()=>handleUnarchive(pj)} style={{ padding:'5px 12px', borderRadius:6, border:'1px solid rgba(66,133,244,0.55)', background:'rgba(66,133,244,0.12)', color:'#4285f4', fontWeight:600, fontSize:12, cursor:'pointer', flexShrink:0, outline:'none' }}>Unarchive</button>
                      :<button onClick={()=>handleArchive(pj)}   style={{ padding:'5px 12px', borderRadius:6, border:'1px solid rgba(245,166,35,0.55)',  background:'rgba(245,166,35,0.12)',  color:'#f5a623', fontWeight:600, fontSize:12, cursor:'pointer', flexShrink:0, outline:'none' }}>Archive</button>}
                    {deleteConfirm===key
                      ?<div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span style={{ fontSize:11, color:'#ff4d6d', flexShrink:0 }}>Sure?</span>
                          <button onClick={()=>handleDelete(pj)} style={{ padding:'5px 10px', borderRadius:6, border:'1px solid rgba(255,77,109,0.55)', background:'rgba(255,77,109,0.22)', color:'#ff4d6d', fontWeight:700, fontSize:12, cursor:'pointer', outline:'none' }}>Yes</button>
                          <button onClick={()=>setDeleteConfirm(null)} style={{ padding:'5px 10px', borderRadius:6, border:'1px solid rgba(255,255,255,0.15)', background:'rgba(255,255,255,0.06)', color:'#7a8aaa', fontWeight:600, fontSize:12, cursor:'pointer', outline:'none' }}>No</button>
                        </div>
                      :<button onClick={()=>setDeleteConfirm(key)} style={{ padding:'5px 12px', borderRadius:6, border:'1px solid rgba(255,77,109,0.55)', background:'rgba(255,77,109,0.12)', color:'#ff4d6d', fontWeight:600, fontSize:12, cursor:'pointer', flexShrink:0, outline:'none' }}>Delete</button>}
                  </div>
                );
              })}
            </div>
          )}
          {saveError&&<div style={{ fontSize:12, color:'#ff4d6d', marginTop:10, padding:'8px 12px', background:'rgba(255,77,109,0.08)', borderRadius:6, border:'1px solid rgba(255,77,109,0.2)' }}>⚠ {saveError}</div>}
        </div>
      </div>
    </div>
  );

  const providerOptions = RESOURCE_OPTIONS[form.providerId]||[];
  const hasCloudRun     = form.selectedResources.includes('google_cloud_run_v2_service');
  const goBack          = () => { setSaveError(''); setView('list'); };

  return (
    <div style={s.overlay} onClick={goBack}>
      <div style={s.panel} onClick={e=>e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <div style={{ fontSize:19, fontWeight:800, color:'#f0f4ff' }}>{editInfo?'Edit Project':'Add Project'}</div>
            <div style={{ fontSize:12, color:'#7a8aaa', marginTop:3 }}>{editInfo?'Update the project details below':'Configure a new project to monitor'}</div>
          </div>
          <button onClick={goBack} style={{ ...s.btnSecondary, padding:'7px 14px', fontSize:12 }}>← Back</button>
        </div>
        <div style={s.body}>
          <div style={{ ...s.field, marginBottom:14 }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 14px', borderRadius:100, border:`1px solid ${accentColor}44`, background:`${accentColor}18`, fontSize:12, fontWeight:700, color:accentColor }}>
              {providerId==='gcp'?'☁ Google Cloud Platform':'⚡ Amazon Web Services'}
            </div>
          </div>
          <div style={s.field}>
            <label style={s.label}>Project Type</label>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {[
                { value:'normal',  title:'Normal',        sub:'Monitored resources with infra actions' },
                { value:'empty',   title:'No Monitoring', sub:'Dashboard link only, no metrics' },
                { value:'billing', title:'Billing Only',  sub:'Cost tracking dashboard' },
              ].map(opt=>{
                const sel=form.projectType===opt.value;
                return(
                  <div key={opt.value} onClick={()=>setField('projectType',opt.value)} style={{ padding:'9px 14px', borderRadius:9, cursor:'pointer', border:sel?`1px solid ${accentColor}66`:'1px solid rgba(255,255,255,0.07)', background:sel?`${accentColor}12`:'rgba(255,255,255,0.03)' }}>
                    <div style={{ fontSize:13, fontWeight:700, color:sel?accentColor:'#c8d4f0' }}>{opt.title}</div>
                    <div style={{ fontSize:11, color:'#4a6080', marginTop:2 }}>{opt.sub}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={s.field}>
            <label style={s.label}>Project Name *</label>
            <input value={form.name} onChange={e=>setField('name',e.target.value)} placeholder="e.g. My Service UAT" style={s.input} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Project Dir Name <span style={{ color:'#4a6080', fontWeight:500, textTransform:'none', letterSpacing:0 }}>(folder under projects/ in repo)</span></label>
            <input value={form.projectDirName} onChange={e=>setField('projectDirName',e.target.value)} placeholder="e.g. my-service-uat  →  projects/my-service-uat/" style={s.input} />
            <div style={{ marginTop:5, fontSize:11, color:'#4a6080' }}>
              Required for infra actions and Terraform resource discovery.
            </div>
          </div>
          {form.providerId==='gcp'&&form.projectType==='normal'&&(
            <div style={s.field}>
              <label style={s.label}>GCP Project ID</label>
              <input value={form.gcpProjectId} onChange={e=>setField('gcpProjectId',e.target.value)} placeholder="e.g. my-project-123456" style={s.input} />
              <div style={{ marginTop:5, fontSize:11, color:'#4a6080' }}>
                Used for auto-detecting GCP resources (Compute Engine, Cloud Run, etc.) — no manual resource selection needed.
              </div>
            </div>
          )}
          <div style={s.field}>
            <label style={s.label}>Dashboard GUID</label>
            <input value={form.dashboardGuid} onChange={e=>setField('dashboardGuid',e.target.value)} placeholder="e.g. Nzc4MjQ3OX..." style={s.input} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Dashboard Short Link</label>
            <input value={form.dashboardLink} onChange={e=>setField('dashboardLink',e.target.value)} placeholder="e.g. https://onenr.io/..." style={s.input} />
          </div>
          {form.projectType==='normal'&&form.providerId==='gcp'&&(
            <div style={{ padding:'10px 14px', background:'rgba(66,133,244,0.06)', border:'1px solid rgba(66,133,244,0.2)', borderRadius:8, marginBottom:18 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#4285f4', marginBottom:4 }}>✦ Auto-detection enabled</div>
              <div style={{ fontSize:11, color:'#7a8aaa', lineHeight:1.5 }}>
                When a GCP Project ID is set, Eagle Eye will automatically detect which resources (Compute Engine, Cloud Run, GKE, etc.) are active by querying New Relic. No manual resource selection is needed.
              </div>
            </div>
          )}
          {form.projectType==='normal'&&form.providerId==='aws'&&(
            <div style={s.field}>
              <label style={s.label}>Resources to Monitor</label>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {providerOptions.map(opt=>{
                  const checked=form.selectedResources.includes(opt.type);
                  return(
                    <label key={opt.type} style={{ display:'flex', alignItems:'flex-start', gap:10, cursor:'pointer', padding:'10px 12px', background:checked?'rgba(255,153,0,0.08)':'rgba(255,255,255,0.03)', borderRadius:8, border:checked?`1px solid ${accentColor}44`:'1px solid rgba(255,255,255,0.07)' }}>
                      <input type="checkbox" checked={checked} onChange={e=>setField('selectedResources',e.target.checked?[...form.selectedResources,opt.type]:form.selectedResources.filter(t=>t!==opt.type))} style={{ accentColor, width:14, height:14, cursor:'pointer', marginTop:2, flexShrink:0 }} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <span style={{ fontSize:13, fontWeight:600, color:'#c8d4f0' }}>{opt.label}</span>
                          <span style={{ fontSize:10, color:opt.scalesToZero?'#4285f4':'#4a5568', background:opt.scalesToZero?'rgba(66,133,244,0.1)':'rgba(255,255,255,0.05)', border:opt.scalesToZero?'1px solid rgba(66,133,244,0.2)':'1px solid rgba(255,255,255,0.07)', borderRadius:100, padding:'1px 7px', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.4px' }}>{opt.scalesToZero?'scales to zero':opt.alwaysOn?'always on':''}</span>
                        </div>
                        {opt.desc&&<div style={{ fontSize:11, color:'#4a6080', marginTop:3 }}>{opt.desc}</div>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {form.projectType==='normal'&&form.providerId==='gcp'&&hasCloudRun&&(
            <div style={s.field}>
              <label style={s.label}>Known Cloud Run Services</label>
              <input value={form.knownServices} onChange={e=>setField('knownServices',e.target.value)} placeholder="e.g. my-api, auth-service" style={s.input} />
            </div>
          )}
          {form.projectType==='normal'&&(
            <div style={s.field}>
              <label style={s.label}>Other Services <span style={{ color:'#4a6080', fontWeight:500, textTransform:'none', letterSpacing:0 }}>(comma separated, display only)</span></label>
              <input value={form.customResources} onChange={e=>setField('customResources',e.target.value)} placeholder="e.g. Redis, Kafka" style={s.input} />
            </div>
          )}
          {saveError&&<div style={{ fontSize:12, color:'#ff4d6d', marginTop:4, padding:'8px 12px', background:'rgba(255,77,109,0.08)', borderRadius:6, border:'1px solid rgba(255,77,109,0.2)' }}>⚠ {saveError}</div>}
        </div>
        <div style={s.footer}>
          <button onClick={goBack} style={s.btnSecondary} disabled={saving}>Cancel</button>
          <button onClick={handleSubmit} style={{ ...s.btnPrimary, background:accentColor, opacity:saving?0.65:1 }} disabled={saving}>{saving?'Saving…':editInfo?'Save Changes':'Add Project'}</button>
        </div>
      </div>
    </div>
  );
};

// ─── GCP auto-detector ────────────────────────────────────────────────────────
const GcpAutoDetectLoader = ({ project, discoveryIndex, detectedResources, onComplete }) => {
  const doneRef = React.useRef(false);
  const isDone = discoveryIndex >= GCP_DISCOVERY_MAP.length;
  React.useEffect(() => {
    if (isDone && !doneRef.current) {
      doneRef.current = true;
      onComplete(detectedResources);
    }
  }, [isDone]);
  if (isDone) return null;
  const candidate = GCP_DISCOVERY_MAP[discoveryIndex];
  const query = `SELECT count(*) AS samples FROM ${candidate.nrTable} WHERE projectId = '${project.gcpProjectId}' SINCE 1 hour ago LIMIT 1`;
  return (
    <NrqlQuery accountIds={[ACCOUNT_ID]} query={query} pollInterval={300000}>
      {({ data, loading }) => {
        if (loading) return null;
        const row = extractRow(data);
        const found = (row?.samples ?? 0) > 0;
        const next = found ? [...detectedResources, { ...candidate }] : detectedResources;
        return (
          <GcpAutoDetectLoader
            project={project}
            discoveryIndex={discoveryIndex + 1}
            detectedResources={next}
            onComplete={onComplete}
          />
        );
      }}
    </NrqlQuery>
  );
};

const GcpProjectAutoLoader = ({ project, projectIndex, provider, results, onManage, onInfraAction }) => {
  const [detectedResources, setDetectedResources] = React.useState(null);
  if (!project.gcpProjectId) {
    return (
      <ProjectResourceLoader
        project={project} resourceIndex={0} collectedStatuses={[]}
        projectIndex={projectIndex} provider={provider} results={results}
        onManage={onManage} onInfraAction={onInfraAction}
      />
    );
  }
  if (detectedResources === null) {
    return (
      <GcpAutoDetectLoader
        project={project} discoveryIndex={0} detectedResources={[]}
        onComplete={(found) => {
          const resources = found.length > 0 ? found : (project.resources ?? []);
          setDetectedResources(resources);
        }}
      />
    );
  }
  const enrichedProject = { ...project, resources: detectedResources };
  return (
    <ProjectResourceLoader
      project={enrichedProject} resourceIndex={0} collectedStatuses={[]}
      projectIndex={projectIndex} provider={provider} results={results}
      onManage={onManage} onInfraAction={onInfraAction}
    />
  );
};

const GhostStateBanner = ({ project }) => {
  const ghToken = React.useContext(GhTokenContext);
  const hasResources = project.resources && project.resources.length > 0;
  if (!hasResources) return null;
  return (
    <div style={{
      marginTop:6, padding:'10px 14px', borderRadius:8,
      background:'rgba(90,104,136,0.10)',
      border:'1px dashed rgba(90,104,136,0.40)',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <span style={{ fontSize:10, fontWeight:800, letterSpacing:'0.8px', textTransform:'uppercase', color:'#6a7a9a' }}>
          Resources · Not Yet Provisioned
        </span>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {project.resources.map((r, i) => (
          <GhostResourceRow key={i} resource={r} hasToken={!!ghToken} />
        ))}
      </div>
      <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:6, fontSize:11, color:'#c8d4f0' }}>
        <GearIcon size={11} color="#7ab3ff" />
        {ghToken
          ? <span>Hit <strong style={{ color:'#7ab3ff', fontStyle:'normal' }}>Apply</strong> above to provision via Terraform</span>
          : <span>Set <strong style={{ color:'#f5a623', fontStyle:'normal' }}>GitHub token</strong> via ⚙ Config, then hit <strong style={{ color:'#7ab3ff' }}>Apply</strong> to provision</span>
        }
      </div>
    </div>
  );
};

// ─── ProjectRow ────────────────────────────────────────────────────────────────
const ProjectRow = ({ project, resourceStatuses, loading, index, billingCost, onInfraAction }) => {
  const [expanded,     setExpanded]     = useState(false);
  const [actionState,  setActionState]  = useState(INFRA_STATES.IDLE);
  const [activeAction, setActiveAction] = useState(null);
  const [hidden,       setHidden]       = useState(false);
  const pollCancelRef = useRef({ cancelled: false });

  const ghToken = React.useContext(GhTokenContext);

  const { lifecycles, setLifecycle: persistLifecycle } = React.useContext(LifecycleContext);
  const projectKey = project.projectDirName || project.name;
  const lifecycle  = lifecycles[projectKey] ?? null;
  const setLifecycle = useCallback(
    (val) => persistLifecycle(projectKey, val),
    [persistLifecycle, projectKey]
  );

  const { loading:tfLoading, hasTf } = useGithubTfFiles(project.projectDirName, ghToken);
  const { resources:tfResources }    = useTerraformResources(project.projectDirName, ghToken);
  const infraReady = hasTf === true;

  useEffect(()=>{ return ()=>{ pollCancelRef.current.cancelled=true; }; },[]);

  useEffect(()=>{
    if (lifecycle === 'terminated') {
      const t = setTimeout(()=>setHidden(true), 45000);
      return ()=>clearTimeout(t);
    }
  }, [lifecycle]);

  useEffect(() => {
    if (lifecycle === 'terminated') setExpanded(false);
  }, [lifecycle]);

  const handleActionDispatched = useCallback((action,token,dispatchTime)=>{
    setActiveAction(action); setActionState(INFRA_STATES.DISPATCHING);
    const effectiveDispatchTime=(dispatchTime||Date.now())-10000;
    pollCancelRef.current={cancelled:false};
    const cancelRef=pollCancelRef.current;
    const onStatusChange=(newState)=>{ if(!cancelRef.cancelled) setActionState(newState); };
    const onComplete=(conclusion)=>{
      if(cancelRef.cancelled) return;
      if(conclusion==='success'){
        const next=NEXT_LIFECYCLE[action];
        if(next) setLifecycle(next);
        requestAnimationFrame(()=>{
          if(cancelRef.cancelled) return;
          setActionState(INFRA_STATES.SUCCEEDED);
          setTimeout(()=>{if(!cancelRef.cancelled){setActionState(INFRA_STATES.IDLE);setActiveAction(null);}},8000);
        });
      } else {
        if(conclusion==='timeout') setActionState(INFRA_STATES.TIMEOUT);
        else setActionState(INFRA_STATES.FAILED);
        setTimeout(()=>{if(!cancelRef.cancelled){setActionState(INFRA_STATES.IDLE);setActiveAction(null);}},8000);
      }
    };
          

    if(token&&token.trim()!==''){
      pollWorkflowRun(token,effectiveDispatchTime,onStatusChange,onComplete,cancelRef);
    } else {
      setTimeout(()=>{if(!cancelRef.cancelled){setActionState(INFRA_STATES.TIMEOUT);setTimeout(()=>{if(!cancelRef.cancelled){setActionState(INFRA_STATES.IDLE);setActiveAction(null);}},6000);}},3000);
    }
  },[setLifecycle]);

  const handleInfraAction = useCallback((proj,action)=>{
    onInfraAction(proj,action,handleActionDispatched);
  },[onInfraAction,handleActionDispatched]);

  const isBusy = actionState===INFRA_STATES.DISPATCHING||actionState===INFRA_STATES.RUNNING;

  if (project.deleted) return (
    <div className="project-row project-row--deleted" style={{ animationDelay:index*80+'ms' }}>
      <div className="project-row__main">
        <div className="project-row__left" style={{ gap:10 }}><span style={{ fontSize:14,opacity:0.65 }}>🗑</span><span className="project-row__name" style={{ color:'#8899bb' }}>{project.name}</span></div>
        <div className="project-row__right"><span className="project-row__deleted-badge">Archived</span>{project.dashboardGuid&&<DashboardIcon onClick={()=>openDashboard(project)} />}</div>
      </div>
    </div>
  );

  if (project.billingOnly) {
    const totalCost=billingCost??null;
    if (project.billingNotConfigured) return (
      <div className={'project-row project-row--billing'+(expanded?' project-row--expanded':'')} style={{ animationDelay:index*80+'ms' }}>
        <div className="project-row__main" onClick={()=>setExpanded(p=>!p)} style={{ cursor:'pointer' }}>
          <div className="project-row__left"><span className="status-dot status-dot--grey" /><span className="project-row__name">{project.name}</span><span style={{ fontSize:10,fontWeight:600,color:'#4285f4',background:'rgba(66,133,244,0.12)',border:'1px solid rgba(66,133,244,0.25)',borderRadius:100,padding:'2px 8px',textTransform:'uppercase' }}>Not Configured</span></div>
          <div className="project-row__right"><span className={'project-row__chevron'+(expanded?' project-row__chevron--open':'')}>›</span></div>
        </div>
        {expanded&&<div className="project-row__detail" style={{ paddingBottom:12 }}><GcpBillingNotConfigured /></div>}
      </div>
    );
    const costLabel=totalCost!=null?'₹'+totalCost.toFixed(0):null, bS=billingCostToStatus(totalCost), dC=bS==='unknown'?'grey':bS;
    return (
      <div className={'project-row project-row--billing'+(expanded?' project-row--expanded':'')+(bS!=='unknown'?' project-row--'+bS:'')} style={{ animationDelay:index*80+'ms' }}>
        <div className="project-row__main" onClick={()=>setExpanded(p=>!p)} style={{ cursor:'pointer' }}>
          <div className="project-row__left"><span className={'status-dot status-dot--'+dC} /><span className="project-row__name">{project.name}</span>{costLabel&&<span className="project-row__uptime-pill">{costLabel} this month</span>}</div>
          <div className="project-row__right"><span className={'project-row__chevron'+(expanded?' project-row__chevron--open':'')}>›</span><DashboardIcon onClick={e=>{e.stopPropagation();openDashboard(project);}} /></div>
        </div>
        {expanded&&<div className="project-row__detail" style={{ paddingBottom:12 }}><BillingSimple cost={totalCost} budget={BILLING_BUDGET_INR} /></div>}
      </div>
    );
  }

  if (project.empty) return (
    <div className={'project-row project-row--clickable'+(expanded?' project-row--expanded':'')} style={{ animationDelay:index*80+'ms', cursor:'pointer', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:10, marginBottom:4 }} onClick={()=>setExpanded(p=>!p)}>
      <div className="project-row__main">
        <div className="project-row__left" style={{ gap:10 }}>
          <span style={{ fontSize:14, color:'#7a8aaa' }}>◎</span>
          <span className="project-row__name" style={{ color:'#c8d4f0' }}>{project.name}</span>
          {tfLoading?<NoInfraBadge checking />:!infraReady?<NoInfraBadge />:null}
        </div>
        <div className="project-row__right">
          <span style={{ fontSize:10,fontWeight:600,color:'#8899bb',background:'rgba(100,120,170,0.18)',border:'1px solid rgba(100,120,170,0.4)',borderRadius:100,padding:'2px 10px',textTransform:'uppercase' }}>No Monitoring</span>
          {project.dashboardGuid&&<DashboardIcon onClick={e=>{e.stopPropagation();openDashboard(project);}} />}
          <span className={`project-row__chevron${expanded?' project-row__chevron--open':''}`} onClick={e=>{e.stopPropagation();setExpanded(p=>!p);}}>›</span>
        </div>
      </div>
      {expanded&&(
        <div className="project-row__detail">
          <InfraStatusBanner actionState={actionState} lastAction={activeAction} onDismiss={()=>{setActionState(INFRA_STATES.IDLE);setActiveAction(null);}} />
          <InfraActionButtons project={project} lifecycle={lifecycle} actionState={actionState} activeAction={activeAction} infraReady={infraReady} tfLoading={tfLoading} ghToken={ghToken} onAction={handleInfraAction} />
        </div>
      )}
    </div>
  );

  if (lifecycle === 'terminated') {
    if (hidden) return null;
    return (
      <div className={`project-row project-row--red${expanded?' project-row--expanded':''}`}
        style={{ animationDelay:`${index*80}ms` }}>
        <div className="project-row__main" onClick={()=>setExpanded(p=>!p)} style={{ cursor:'pointer' }}>
          <div className="project-row__left">
            <span className="status-dot status-dot--red" />
            <span className="project-row__name">{project.name}</span>
            <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:10, fontWeight:700, color:'#ff4d6d', background:'rgba(255,77,109,0.12)', border:'1px solid rgba(255,77,109,0.3)', borderRadius:100, padding:'2px 8px', textTransform:'uppercase' }}>
              <PowerOffIcon size={10} color="#ff4d6d" /> Terminated
            </span>
          </div>
          <div className="project-row__right">
            <span className={`project-row__chevron${expanded?' project-row__chevron--open':''}`}>›</span>
          </div>
        </div>
        {expanded&&(
          <div className="project-row__detail">
            <InfraStatusBanner actionState={actionState} lastAction={activeAction} onDismiss={()=>{setActionState(INFRA_STATES.IDLE);setActiveAction(null);}} />
            <InfraActionButtons project={project} lifecycle={lifecycle} actionState={actionState} activeAction={activeAction} infraReady={infraReady} tfLoading={tfLoading} ghToken={ghToken} onAction={handleInfraAction} />
            {project.resources && project.resources.length > 0 && (
              <div className="project-row__resource-list" style={{ display:'flex', flexDirection:'column', gap:'2px', padding:'8px 0' }}>
                {project.resources.map((r,i)=>(
                  <ExpandableResourceRow key={i} resource={{...r, status:'unknown', row:null}} project={project} lifecycle={lifecycle} tfResources={tfResources} />
                ))}
              </div>
            )}
            <div style={{ padding:'8px 0 4px', color:'#7a8aaa', fontSize:12 }}>
              All resources destroyed via <code style={{ color:'#ff4d6d' }}>terraform destroy</code>. Use <strong style={{ color:'#4285f4' }}>Apply</strong> to re-provision.
            </div>
          </div>
        )}
      </div>
    );
  }

  const rawStatus = loading ? 'unknown' : worstStatus(resourceStatuses.map(r => r.status));
  const status    = lifecycle === 'stopped'
    ? 'yellow'
    : lifecycle === 'provisioned' && rawStatus === 'unknown'
      ? 'green'
      : rawStatus;

  const hasResources = project.resources&&project.resources.length>0;
  const hasDashboard = !!(project.dashboardGuid||project.dashboardLink);
  const handleRowClick = useCallback(()=>setExpanded(p=>!p),[]);

  const uptimeSummary = (() => {
    if (loading) return null;
    const cr=resourceStatuses.filter(r=>r.type==='google_cloud_run_v2_service'&&r.row);
    if (cr.length===0) return null;
    if (cr.every(r=>r.status==='green')) return '100%';
    if (cr.some(r=>r.status==='green'))  return 'Partial';
    return 'Down';
  })();

  const billingSummary = (() => {
    if (loading) return null;
    const b=resourceStatuses.find(r=>r.type==='aws_billing'&&r.row);
    if (!b||b.row?.totalCostINR==null) return null;
    return `₹${b.row.totalCostINR.toFixed(0)}`;
  })();

  const showGhostState = !lifecycle && hasResources;

  const renderResourceDetail = () => {
    if (loading) return <span className="project-row__detail-loading">Checking resource health…</span>;

    if (resourceStatuses.length === 0) {
      if (project.gcpProjectId) {
        return (
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 4px', fontSize:12, color:'#4a6080' }}>
            <SpinnerIcon size={11} color="#4a6080" />
            <span>Auto-detecting GCP resources…</span>
          </div>
        );
      }
      return <div style={{ fontSize:12, color:'#4a6080', fontStyle:'italic', padding:'6px 0' }}>No resources configured for monitoring.</div>;
    }

    if (showGhostState) {
      return <GhostStateBanner project={project} />;
    }

    return (
      <div className="project-row__resource-list" style={{ display:'flex', flexDirection:'column', gap:'2px', padding:'8px 0' }}>
        {resourceStatuses.map((r,i)=>(
          <ExpandableResourceRow key={i} resource={r} project={project} lifecycle={lifecycle} tfResources={tfResources} />
        ))}
      </div>
    );
  };

  const effectiveStatus = showGhostState ? 'unknown' : (isBusy ? 'yellow' : status);

  return (
    <div className={`project-row project-row--${isBusy?'yellow':effectiveStatus}${expanded?' project-row--expanded':''} project-row--clickable`} style={{ animationDelay:`${index*80}ms` }}>
      <div className="project-row__main" onClick={handleRowClick}>
        <div className="project-row__left">
          <StatusDot status={effectiveStatus} />
          <span className="project-row__name">{project.name}</span>
          {!isBusy && lifecycle === 'provisioned' && status === 'green' && rawStatus === 'unknown' && !loading && (
            <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:10, fontWeight:700,
              color:'#7a8aaa', background:'rgba(122,138,170,0.12)', border:'1px solid rgba(122,138,170,0.3)',
              borderRadius:100, padding:'2px 9px', letterSpacing:'0.4px', flexShrink:0 }}>
              <SpinnerIcon size={9} color="#7a8aaa" /> Waiting for metrics
            </span>
          )}
          {!isBusy&&(tfLoading
            ? <NoInfraBadge checking />
            : showGhostState
              ? ghToken
                ? <span style={{ fontSize:10, fontWeight:700, color:'#5a9aee', background:'rgba(66,133,244,0.12)', border:'1px dashed rgba(66,133,244,0.35)', borderRadius:100, padding:'2px 9px', textTransform:'uppercase', letterSpacing:'0.5px', flexShrink:0 }}>Not Provisioned</span>
                : <span style={{ fontSize:10, fontWeight:700, color:'#5a6888', background:'rgba(90,104,136,0.15)', border:'1px dashed rgba(90,104,136,0.40)', borderRadius:100, padding:'2px 9px', textTransform:'uppercase', letterSpacing:'0.5px', flexShrink:0 }}>No Infra Yet</span>
              : !infraReady
                ? <NoInfraBadge />
                : null
          )}
          {!loading&&infraReady&&!showGhostState&&uptimeSummary!==null&&!isBusy&&<span className="project-row__uptime-pill">{uptimeSummary} uptime</span>}
          {!loading&&infraReady&&!showGhostState&&billingSummary!==null&&!isBusy&&<span className="project-row__uptime-pill">{billingSummary} today</span>}
          {isBusy&&(
            <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:10, fontWeight:700, color:'#f5a623', background:'rgba(245,166,35,0.1)', border:'1px solid rgba(245,166,35,0.3)', borderRadius:100, padding:'2px 8px' }}>
              <SpinnerIcon size={10} color="#f5a623" />
              {actionState===INFRA_STATES.DISPATCHING?'Dispatching…':`${activeAction} running…`}
            </span>
          )}
        </div>
        <div className="project-row__right">
          <span className={`project-row__chevron${expanded?' project-row__chevron--open':''}`} onClick={e=>{e.stopPropagation();setExpanded(p=>!p);}}>›</span>
          {hasDashboard&&<DashboardIcon onClick={e=>{e.stopPropagation();openDashboard(project);}} />}
        </div>
      </div>

      {expanded&&(
        <div className="project-row__detail">
          <InfraStatusBanner actionState={actionState} lastAction={activeAction} onDismiss={()=>{setActionState(INFRA_STATES.IDLE);setActiveAction(null);}} />
          <InfraActionButtons project={project} lifecycle={lifecycle} actionState={actionState} activeAction={activeAction} infraReady={infraReady} tfLoading={tfLoading} ghToken={ghToken} onAction={handleInfraAction} />
          {hasResources&&renderResourceDetail()}
        </div>
      )}
    </div>
  );
};

const openDashboard = (project) => {
  if (project.dashboardGuid) {
    try { navigation.openStackedNerdlet({ id:'dashboards.detail', urlState:{ entityGuid:project.dashboardGuid, timeRange:project.billingOnly?{begin_time:Date.now()-30*24*60*60*1000,end_time:Date.now()}:{duration:86400000} } }); return; } catch (_) {}
  }
  if (project.dashboardLink) window.open(project.dashboardLink, '_blank');
};

// ─── Card / list plumbing ──────────────────────────────────────────────────────
const DotsButton = ({ onClick, accentColor }) => (
  <button onClick={onClick} title="Manage projects"
    style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:3, width:30, height:26, borderRadius:7, flexShrink:0, border:'none', outline:'none', boxShadow:'none', background:'transparent', cursor:'pointer', padding:0, transition:'background 0.15s' }}
    onMouseEnter={e=>e.currentTarget.style.background=`${accentColor}22`}
    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
    <span style={{ width:4,height:4,borderRadius:'50%',background:accentColor,opacity:0.9,flexShrink:0 }} />
    <span style={{ width:4,height:4,borderRadius:'50%',background:accentColor,opacity:0.9,flexShrink:0 }} />
    <span style={{ width:4,height:4,borderRadius:'50%',background:accentColor,opacity:0.9,flexShrink:0 }} />
  </button>
);

const SingleResourceQuery = ({ resource, project, children }) => {
  const query = buildResourceQuery(resource, project);
  const [timedOut, setTimedOut] = React.useState(false);
  React.useEffect(()=>{ const t=setTimeout(()=>setTimedOut(true),6000); return ()=>clearTimeout(t); },[query]);
  return (
    <NrqlQuery accountIds={[ACCOUNT_ID]} query={query} pollInterval={60000}>
      {({ data, loading, error }) => {
        let rs;
        if (loading&&!timedOut) rs={...resource,status:'unknown',row:null,loading:true};
        else if (loading&&timedOut) rs={...resource,status:noData(resource),row:null,loading:false};
        else if (error||!data) rs={...resource,status:noData(resource),row:null,loading:false};
        else { const row=extractRow(data); const status=row===null?noData(resource):deriveResourceStatus(resource,row); const reason=deriveResourceReason(resource,row,status); rs={...resource,status,reason,row,loading:false}; }
        return children(rs);
      }}
    </NrqlQuery>
  );
};

const ProjectResourceLoader = ({ project, resourceIndex, collectedStatuses, projectIndex, provider, results, onManage, onInfraAction }) => {
  if (resourceIndex>=project.resources.length) {
    const anyLoading=collectedStatuses.some(r=>r.loading);
    return <ProjectListInner provider={provider} projectIndex={projectIndex+1} results={[...results,{projectIndex,loading:anyLoading,resourceStatuses:collectedStatuses}]} onManage={onManage} onInfraAction={onInfraAction} />;
  }
  const resource=project.resources[resourceIndex];
  return (
    <SingleResourceQuery resource={resource} project={project}>
      {rs=><ProjectResourceLoader project={project} resourceIndex={resourceIndex+1} collectedStatuses={[...collectedStatuses,rs]} projectIndex={projectIndex} provider={provider} results={results} onManage={onManage} onInfraAction={onInfraAction} />}
    </SingleResourceQuery>
  );
};

const ProjectListInner = ({ provider, projectIndex, results, onManage, onInfraAction }) => {
  if (projectIndex>=provider.projects.length) {
    if (provider.id==='aws') {
      const bQ=`SELECT max(\`aws.billing.EstimatedCharges\`) * 92 AS totalCostINR FROM Metric WHERE aws.Namespace = 'AWS/Billing' SINCE this month`;
      return <NrqlQuery accountIds={[ACCOUNT_ID]} query={bQ} pollInterval={300000}>{({ data })=>{ const bc=data?.[0]?.data?.[0]?.y??data?.[0]?.data?.[0]?.totalCostINR??null; return <ProjectsRendered provider={provider} allResults={results} billingCost={bc} onManage={onManage} onInfraAction={onInfraAction} />; }}</NrqlQuery>;
    }
    return <ProjectsRendered provider={provider} allResults={results} billingCost={null} onManage={onManage} onInfraAction={onInfraAction} />;
  }
  const project=provider.projects[projectIndex];
  if (project.deleted||project.empty||project.billingNotConfigured||project.billingOnly||!project.resources||project.resources.length===0) {
    if (provider.id === 'gcp' && !project.deleted && !project.empty && !project.billingNotConfigured && !project.billingOnly && project.gcpProjectId) {
      return (
        <GcpProjectAutoLoader
          project={project} projectIndex={projectIndex} provider={provider}
          results={results} onManage={onManage} onInfraAction={onInfraAction}
        />
      );
    }
    return <ProjectListInner provider={provider} projectIndex={projectIndex+1} results={[...results,{projectIndex,loading:false,resourceStatuses:[]}]} onManage={onManage} onInfraAction={onInfraAction} />;
  }
  if (provider.id === 'gcp' && project.gcpProjectId) {
    return (
      <GcpProjectAutoLoader
        project={project} projectIndex={projectIndex} provider={provider}
        results={results} onManage={onManage} onInfraAction={onInfraAction}
      />
    );
  }
  return <ProjectResourceLoader project={project} resourceIndex={0} collectedStatuses={[]} projectIndex={projectIndex} provider={provider} results={results} onManage={onManage} onInfraAction={onInfraAction} />;
};

const ArchivedAwareProjectList = ({ provider, allResults, billingCost, onInfraAction }) => {
  const [archivedOpen, setArchivedOpen] = React.useState(false);
  const activeProjects   = provider.projects.filter(p=>!p.deleted);
  const archivedProjects = provider.projects.filter(p=>p.deleted);
  const indexOf          = (project) => provider.projects.indexOf(project);
  return (
    <>
      {activeProjects.map((project)=>{
        const i=indexOf(project), r=allResults.find(res=>res.projectIndex===i)??allResults[i];
        return <ProjectRow key={project.projectDirName||project.name} project={project} resourceStatuses={r?.resourceStatuses??[]} loading={r?.loading??false} index={i} billingCost={project.billingOnly?billingCost:null} onInfraAction={onInfraAction} />;
      })}
      {archivedProjects.length>0&&(
        <div style={{ marginTop:activeProjects.length>0?10:0 }}>
          <button onClick={()=>setArchivedOpen(o=>!o)} style={{ display:'flex', alignItems:'center', gap:7, background:'none', border:'1px solid rgba(255,255,255,0.07)', borderRadius:8, padding:'6px 12px', cursor:'pointer', color:'#4a5568', fontSize:11, fontWeight:700, letterSpacing:'0.6px', textTransform:'uppercase', width:'100%', outline:'none' }}>
            <span style={{ display:'inline-block', transition:'transform 0.2s', transform:archivedOpen?'rotate(90deg)':'rotate(0deg)', fontSize:12 }}>›</span>
            <span>🗑 Archived</span>
            <span style={{ marginLeft:'auto', fontSize:10, background:'rgba(74,85,104,0.2)', border:'1px solid rgba(74,85,104,0.3)', borderRadius:100, padding:'1px 8px' }}>{archivedProjects.length}</span>
          </button>
          {archivedOpen&&(
            <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:4 }}>
              {archivedProjects.map((project)=>{const i=indexOf(project),r=allResults.find(res=>res.projectIndex===i)??allResults[i];return<ProjectRow key={project.projectDirName||project.name} project={project} resourceStatuses={r?.resourceStatuses??[]} loading={r?.loading??false} index={i} billingCost={null} onInfraAction={onInfraAction} />;})}</div>
          )}
        </div>
      )}
    </>
  );
};

const ProjectsRendered = ({ provider, allResults, billingCost, onManage, onInfraAction }) => {
  const projectStatuses = provider.projects.map((p, i) => {
    if (p.deleted) return 'deleted';
    if (p.empty) return 'empty';
    if (p.billingNotConfigured) return 'unknown';
    if (p.billingOnly) return 'billing';
    const r = allResults.find(res => res.projectIndex === i) ?? allResults[i];
    if (!r || r.loading) return 'unknown';
    if (!r.resourceStatuses || r.resourceStatuses.length === 0) return 'unknown';
    const hasAnyRealData = r.resourceStatuses.some(
      rs => rs.status === 'green' || rs.status === 'red'
    );
    if (!hasAnyRealData) return 'unknown';
    return worstStatus(r.resourceStatuses.map(rs => rs.status));
  });

  const projectHealthMap={};
  provider.projects.forEach((p,i)=>{projectHealthMap[p.name]=projectStatuses[i]??'unknown';});

  const live = projectStatuses.filter(s => s !== 'deleted' && s !== 'empty' && s !== 'unknown' && s !== 'billing');
  const cloudStatus = live.length > 0 ? worstStatus(live) : 'unknown';

  const billStatus  = billingCostToStatus(billingCost);
  const overall     = provider.id==='aws'?worstStatus([cloudStatus,billStatus].filter(s=>s!=='unknown')):cloudStatus;
  const cardMeta    = STATUS_META[overall]??STATUS_META.unknown;
  const meta        = PROVIDER_META[provider.id], accentColor=meta.accent;
  const gcpBillingProject       = provider.id==='gcp'?provider.projects.find(p=>p.billingOnly):null;
  const gcpBillingNotConfigured = gcpBillingProject?.billingNotConfigured??false;
  return (
    <>
      <style>{`.cloud-card--${provider.id}{border-color:${cardMeta.color}!important;box-shadow:0 8px 40px ${cardMeta.color}22,inset 0 1px 0 rgba(255,255,255,0.07)!important;}`}</style>
      <div className="cloud-card__header">
        <div className="cloud-card__title-group">
          <div className="cloud-card__icon" style={{ color:accentColor }}>{provider.icon}</div>
          <div><h2 className="cloud-card__name">{provider.name}</h2><span className="cloud-card__label">{provider.label}</span></div>
          <div className="cloud-card__header-pills">
            <StatusBadge status={cloudStatus} label="Resources" />
            {provider.id==='aws'&&<BillingHealthBadge cost={billingCost} />}
            {provider.id==='gcp'&&gcpBillingNotConfigured&&(
              <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:100, fontSize:11, fontWeight:600, background:'rgba(66,133,244,0.10)', border:'1px solid rgba(66,133,244,0.25)', color:'#4285f4', flexShrink:0 }}>
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><circle cx="4" cy="4" r="3.5" stroke="#4285f4" strokeWidth="1" fill="none" /><line x1="4" y1="2" x2="4" y2="4.5" stroke="#4285f4" strokeWidth="1" strokeLinecap="round" /><circle cx="4" cy="6" r="0.6" fill="#4285f4" /></svg>
                Billing · Not Configured
              </span>
            )}
            {provider.id==='gcp'&&!gcpBillingNotConfigured&&gcpBillingProject&&<BillingHealthBadge cost={billingCost} />}
            <DotsButton onClick={()=>onManage(projectHealthMap)} accentColor={accentColor} />
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

// ─── App shell ─────────────────────────────────────────────────────────────────
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
    onMouseEnter={e=>e.currentTarget.style.opacity='0.8'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
    <span>{hasToken?'✓':'⚠'}</span>
    <span>{hasToken?'Token configured':'Set ACCESS_TOKEN'}</span>
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

// ─── EagleEye root ────────────────────────────────────────────────────────────
const EagleEye = () => {
  const [providers,    setProviders]    = useState(null);
  const [ghToken,      setGhToken]      = useState('');
  const [showModal,    setShowModal]    = useState(null);
  const [showConfig,   setShowConfig]   = useState(false);
  const [loadError,    setLoadError]    = useState(false);
  const [infraConfirm, setInfraConfirm] = useState(null);
  const [lifecycles,   setLifecycles]   = useState({});

  const lifecyclesRef = useRef({});
  useEffect(() => { lifecyclesRef.current = lifecycles; }, [lifecycles]);

  useEffect(()=>{
    AccountStorageQuery.query({ accountId:ACCOUNT_ID, collection:STORAGE_COLLECTION, documentId:STORAGE_DOC_ID })
      .then(({ data, error })=>{
        console.log('[Eagle Eye] RAW NerdStorage response:', JSON.stringify({ data, error }));
        if (error) {
          console.error('[Eagle Eye] NerdStorage load error:', error);
          setLoadError(true);
          setProviders(mergeAutoDiscovered(DEFAULT_CLOUD_PROVIDERS));
        } else {
          const loaded = data?.document?.providers ?? data?.providers ?? null;
          if (loaded && Array.isArray(loaded) && loaded.length > 0) {
            setProviders(mergeAutoDiscovered(loaded));
          } else {
            setProviders(mergeAutoDiscovered(DEFAULT_CLOUD_PROVIDERS));
          }
        }
      }).catch((e)=>{
        console.error('[Eagle Eye] NerdStorage load exception:', e);
        setLoadError(true);
        setProviders(mergeAutoDiscovered(DEFAULT_CLOUD_PROVIDERS));
      });

    AccountStorageQuery.query({ accountId:ACCOUNT_ID, collection:STORAGE_COLLECTION, documentId:STORAGE_CONFIG_ID })
      .then(({ data })=>{
        const token = data?.document?.accessToken ?? data?.accessToken ?? null;
        if (token) setGhToken(token);
      })
      .catch(()=>{});

    AccountStorageQuery.query({ accountId:ACCOUNT_ID, collection:STORAGE_COLLECTION, documentId:STORAGE_LIFECYCLE_ID })
      .then(({ data })=>{
        const loaded = data?.document?.lifecycles ?? data?.lifecycles ?? null;
        if (loaded) {
          console.log('[Eagle Eye] Lifecycles loaded:', JSON.stringify(loaded));
          setLifecycles(loaded);
        }
      })
      .catch(()=>{});
  },[]);

  const handleLifecycleChange = useCallback((projectKey, newLifecycle) => {
    const updated = { ...lifecyclesRef.current, [projectKey]: newLifecycle };
    lifecyclesRef.current = updated;
    setLifecycles(updated);
    console.log('[Eagle Eye] Saving lifecycle:', JSON.stringify(updated));
    AccountStorageMutation.mutate({
      accountId:  ACCOUNT_ID,
      actionType: AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT,
      collection: STORAGE_COLLECTION,
      documentId: STORAGE_LIFECYCLE_ID,
      document:   { lifecycles: updated },
    }).then(({ error }) => {
      if (error) console.error('[Eagle Eye] lifecycle save failed:', error);
      else       console.log('[Eagle Eye] lifecycle saved OK');
    }).catch(err => console.error('[Eagle Eye] lifecycle save exception:', err));
  }, []);
    
  const handleSave = async (newProviders) => {
    const saved = await persistProviders(newProviders);
    setProviders(mergeAutoDiscovered(saved));
  };

  const handleSaveToken = async (token) => {
    const { error } = await AccountStorageMutation.mutate({ accountId:ACCOUNT_ID, actionType:AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT, collection:STORAGE_COLLECTION, documentId:STORAGE_CONFIG_ID, document:{ accessToken:token } });
    if (error) throw new Error('Failed to save token: '+(error.message||JSON.stringify(error)));
    setGhToken(token);
  };

  if (!providers) return <EagleEyeLoader />;

  const handleInfraAction=(project,action,onDispatched)=>{ setInfraConfirm({ project, action, onDispatched }); };

  return (
    <LifecycleContext.Provider value={{ lifecycles, setLifecycle: handleLifecycleChange }}>
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
              <ConfigButton hasToken={!!ghToken} onClick={()=>setShowConfig(true)} />
            </div>
            {loadError&&<div style={{ fontSize:11, color:'#f5a623', marginTop:8 }}>⚠ Could not connect to NerdStorage — showing defaults. Changes will not persist.</div>}
          </header>

          <div className="ee-grid">
            {providers.map(provider=>(
              <CloudCard key={provider.id} provider={provider}
                onManage={(healthMap)=>setShowModal({ providerId:provider.id, projectHealthMap:healthMap })}
                onInfraAction={handleInfraAction}
              />
            ))}
          </div>

          <footer className="ee-footer">
            <span>Click any project to expand health details · click the grid icon to open its dashboard · click ··· for infrastructure actions</span>
          </footer>

          {showModal&&(
            <ProjectManagerModal providers={providers} providerId={showModal.providerId} projectHealthMap={showModal.projectHealthMap} onSave={handleSave} onClose={()=>setShowModal(null)} />
          )}
          {showConfig&&(
            <ConfigModal currentToken={ghToken} onSave={handleSaveToken} onClose={()=>setShowConfig(false)} />
          )}
          {infraConfirm&&(
            <InfraConfirmModal project={infraConfirm.project} action={infraConfirm.action} ghToken={ghToken}
              onConfirm={(dispatchTime)=>{ infraConfirm.onDispatched?.(infraConfirm.action,ghToken,dispatchTime); setInfraConfirm(null); }}
              onCancel={()=>setInfraConfirm(null)}
            />
          )}
        </div>
      </GhTokenContext.Provider>
    </LifecycleContext.Provider>
  );
};

