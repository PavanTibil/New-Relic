#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Repo root ───────────────────────────────────────────────────────────────
const REPO_ROOT    = process.cwd();
const PROJECTS_DIR = path.join(REPO_ROOT, 'projects');
const OUTPUT_PATH  = path.join(REPO_ROOT, 'nerdlets', 'test', 'auto-discovered-projects.json');

const SIGNAL_FILE  = '/tmp/eagle-eye-has-changes';

// ─── Terraform resource map ──────────────────────────────────────────────────
const TF_RESOURCE_MAP = {
  google_cloud_run_service:        { label: 'Cloud Run',   type: 'gcp_cloudrun',  alwaysOn: false, scalesToZero: true },
  google_cloud_run_v2_service:     { label: 'Cloud Run',   type: 'gcp_cloudrun',  alwaysOn: false, scalesToZero: true },
  google_cloud_run_v2_job:         { label: 'Cloud Run',   type: 'gcp_cloudrun',  alwaysOn: false, scalesToZero: true },
  google_sql_database_instance:    { label: 'Cloud SQL',   type: 'gcp_cloudsql',  alwaysOn: true  },
  google_bigquery_dataset:         { label: 'BigQuery',    type: 'gcp_bigquery',  alwaysOn: false },
  google_bigquery_table:           { label: 'BigQuery',    type: 'gcp_bigquery',  alwaysOn: false },
  google_storage_bucket:           { label: 'GCS',         type: 'gcp_gcs',       alwaysOn: true  },
  google_container_cluster:        { label: 'GKE',         type: 'gcp_gke',       alwaysOn: true  },
  google_pubsub_topic:             { label: 'Pub/Sub',     type: 'gcp_pubsub',    alwaysOn: true  },

  aws_instance:                    { label: 'EC2',         type: 'aws_ec2',        alwaysOn: true },
  aws_autoscaling_group:           { label: 'EC2',         type: 'aws_ec2',        alwaysOn: true },
  aws_launch_template:             { label: 'EC2',         type: 'aws_ec2',        alwaysOn: true },
  aws_db_instance:                 { label: 'RDS',         type: 'aws_rds',        alwaysOn: true },
  aws_rds_cluster:                 { label: 'RDS',         type: 'aws_rds',        alwaysOn: true },
  aws_apprunner_service:           { label: 'App Runner',  type: 'aws_apprunner',  alwaysOn: true },
  aws_cloudfront_distribution:     { label: 'CloudFront',  type: 'aws_cloudfront', alwaysOn: true },
  aws_lambda_function:             { label: 'Lambda',      type: 'aws_lambda',     alwaysOn: false },
  aws_ecs_service:                 { label: 'ECS',         type: 'aws_ecs',        alwaysOn: true },
  aws_ecs_cluster:                 { label: 'ECS',         type: 'aws_ecs',        alwaysOn: true },
  aws_eks_cluster:                 { label: 'EKS',         type: 'aws_eks',        alwaysOn: true },
  aws_s3_bucket:                   { label: 'S3',          type: 'aws_s3',         alwaysOn: true },
  aws_elasticache_cluster:         { label: 'ElastiCache', type: 'aws_elasticache',alwaysOn: true },
  aws_lb:                          { label: 'ALB/NLB',     type: 'aws_alb',        alwaysOn: true },
  aws_alb:                         { label: 'ALB/NLB',     type: 'aws_alb',        alwaysOn: true },
};

const LABEL_TO_RESOURCE = Object.fromEntries(
  Object.values(TF_RESOURCE_MAP).map(r => [r.label, r])
);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function findTfFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const walk = (current) => {
    fs.readdirSync(current, { withFileTypes: true }).forEach(entry => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.tf')) results.push(full);
    });
  };
  walk(dir);
  return results;
}

function readTfFiles(tfFilePaths) {
  return tfFilePaths.map(f => {
    try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
  }).join('\n');
}

function detectProvider(tf) {
  if (/resource\s+"google_/.test(tf)) return 'gcp';
  if (/resource\s+"aws_/.test(tf))    return 'aws';
  return null;
}

function detectResources(tf) {
  const seen = new Set();
  const found = [];
  const re = /resource\s+"(\w+)"/g;
  let m;
  while ((m = re.exec(tf)) !== null) {
    const meta = TF_RESOURCE_MAP[m[1]];
    if (meta && !seen.has(meta.type)) {
      seen.add(meta.type);
      found.push({ ...meta });
    }
  }
  return found;
}

function dirToName(name) {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Main ────────────────────────────────────────────────────────────────────
function main() {
  console.log(`\n🦅 Eagle Eye discovery — ${new Date().toISOString()}`);

  let registry = {};
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      registry = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    } catch {}
  }

  // ✅ FIX: DO NOT EXIT — treat missing folder as empty
  let projectDirs = [];

  if (!fs.existsSync(PROJECTS_DIR)) {
    console.log('⚠️ projects/ directory not found — treating as empty (all projects will be removed)');
  } else {
    projectDirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  }

  const liveOnDisk = new Set(projectDirs);

  let addedCount = 0;
  let removedCount = 0;

  // ── ADD ───────────────────────────────────────────────────────────────────
  for (const projectName of projectDirs) {
    if (registry[projectName]) continue;

    const modulesPath = path.join(PROJECTS_DIR, projectName, 'modules');
    const tfFiles = findTfFiles(modulesPath);

    if (tfFiles.length === 0) continue;

    const tf = readTfFiles(tfFiles);
    const provider = detectProvider(tf);
    if (!provider) continue;

    const resources = detectResources(tf);

    registry[projectName] = {
      projectDirName: projectName,
      name: dirToName(projectName),
      provider,
      resources
    };

    addedCount++;
  }

  // ── REMOVE ────────────────────────────────────────────────────────────────
  for (const key of Object.keys(registry)) {
    if (!liveOnDisk.has(key)) {
      delete registry[key];
      removedCount++;
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(registry, null, 2) + '\n');

  const hasChanges = addedCount > 0 || removedCount > 0;

  if (hasChanges) {
    fs.writeFileSync(SIGNAL_FILE, 'changed\n');
    console.log(`🚀 Changes detected (added: ${addedCount}, removed: ${removedCount})`);
  } else {
    console.log('No changes');
  }
}

main();
