import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { NrqlQuery, navigation } from 'nr1';
import './styles.scss';

const GhTokenContext = React.createContext('');

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

const ACCOUNT_ID = 7782479;

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

const TF_TO_EE_TYPE = {
  aws_instance:                     'aws_ec2',
  aws_launch_template:              'aws_ec2',
  aws_autoscaling_group:            'aws_ec2',
  aws_launch_configuration:         'aws_ec2',
  aws_apprunner_service:            'aws_apprunner',
  aws_db_instance:                  'aws_rds',
  aws_rds_cluster:                  'aws_rds',
  aws_rds_cluster_instance:         'aws_rds',
  aws_cloudfront_distribution:      'aws_cloudfront',
  aws_ecs_cluster:                  'aws_ecs',
  aws_ecs_service:                  'aws_ecs',
  aws_ecs_task_definition:          'aws_ecs',
  aws_lambda_function:              'aws_lambda',
  aws_s3_bucket:                    'aws_s3',
  aws_s3_bucket_object:             'aws_s3',
};

const ec2ProjectFilter = (project) => {
  const dirName = project.projectDirName || '';
  const projName = project.name || '';
  const gcpId = project.gcpProjectId || '';
  const tag = dirName || gcpId || projName;
  const tagCap = projName || tag;
  return `(\`aws.ec2.tag.Project\` = '${tag}' OR \`aws.ec2.tag.Project\` = '${tagCap}' OR \`aws.ec2.tag.project\` = '${tag}' OR \`aws.ec2.tag.project\` = '${tagCap}' OR \`aws.ec2.tag.Name\` LIKE '${tag}%' OR \`aws.ec2.tag.Name\` LIKE '${tagCap}%')`;
};

// ─── GitHub TF file checker (hasTf) ──────────────────────────────────────────
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

// ─── GitHub TF resource auto-detector ────────────────────────────────────────
const useGithubTfResources = (projectDirName, token, providerId) => {
  const [state, setState] = React.useState({ loading: false, resources: null });

  React.useEffect(() => {
    if (!projectDirName || !token || !providerId) {
      setState({ loading: false, resources: null });
      return;
    }
    setState({ loading: true, resources: null });
    let cancelled = false;

    const ghHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    const listTfFiles = async (path, depth = 0) => {
      if (depth > 4) return [];
      const r = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`,
        { headers: ghHeaders }
      );
      if (!r.ok) return [];
      const items = await r.json();
      if (!Array.isArray(items)) return [];
      let files = [];
      for (const item of items) {
        if (item.type === 'file' && item.name.endsWith('.tf')) files.push(item);
        else if (item.type === 'dir' && !item.name.startsWith('.')) {
          const nested = await listTfFiles(item.path, depth + 1);
          files = [...files, ...nested];
        }
      }
      return files;
    };

    const run = async () => {
      const files = await listTfFiles(`projects/${projectDirName}`);
      const foundEeTypes = new Set();
      for (const file of files) {
        try {
          const r = await fetch(file.download_url);
          if (!r.ok) continue;
          const content = await r.text();
          const regex = /resource\s+"([a-z][a-z0-9_]*)"\s+"/g;
          let m;
          while ((m = regex.exec(content)) !== null) {
            const eeType = TF_TO_EE_TYPE[m[1]];
            if (eeType) foundEeTypes.add(eeType);
          }
        } catch (e) {
          console.log('[TF-detect] failed to read file', file.path, e);
        }
      }
      if (cancelled) return;
      const allOpts = RESOURCE_OPTIONS[providerId] || [];
      const resources = allOpts.filter(o => foundEeTypes.has(o.type));
      setState({ loading: false, resources });
    };

    run().catch((e) => {
      console.error('[TF-detect] run failed:', e);
      if (!cancelled) setState({ loading: false, resources: [] });
    });

    return () => { cancelled = true; };
  }, [projectDirName, token, providerId]);

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
const TrashIcon = ({ size = 11, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
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
  aws_ec2: (p) => { const pf = ec2ProjectFilter(p); return `SELECT latest(\`aws.ec2.StatusCheckFailed\`) AS statusFailed, latest(\`aws.ec2.CPUUtilization\`) AS cpu, latest(\`aws.ec2.tag.Name\`) AS instanceName FROM Metric WHERE aws.Namespace = 'AWS/EC2' AND ${pf} FACET \`aws.ec2.InstanceId\` SINCE 30 days ago LIMIT 50`; },
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
      if ((row.samples ?? 0) === 0) return 'yellow';
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
    case 'google_sql_database_instance':  return 'No metric samples received — DB may be stopped or unreachable';
    case 'google_compute_instance': {
      if ((row.samples ?? 0) === 0) return 'No metric samples — VM may be stopped or not reporting';
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
      if (s === 0) return 'No metric samples received from CloudFront namespace';
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
      if (s === 0) return `No metric samples — tag instances with Project=${resource._projectTag||'<project>'} to scope them`;
      const parts = [];
      if (sf > 0)  parts.push('System status check failed');
      if (if_ > 0) parts.push('Instance status check failed');
      if (cpu !== null && cpu > 75) parts.push(`CPU usage: ${cpu.toFixed(1)}%${cpu > 90 ? ' (critical)' : ''}`);
      return parts.join(' · ') || null;
    }
    case 'google_cloud_run_v2_service': return 'No billable instance time — all revisions may be scaled to zero';
    case 'google_container_cluster':    return 'No GKE cluster samples — cluster may be stopped or not reporting';
    case 'aws_ecs':  return 'No ECS metrics — service may be stopped or not yet deployed';
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

// ─── GhostResourceRow ─────────────────────────────────────────────────────────
const GhostResourceRow = ({ resource, hasToken = false }) => (
  <div style={{
    display:'flex', alignItems:'center', gap:10, padding:'7px 12px',
