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
  const seen  = new Set();
  const found = [];
  const re    = /resource\s+"(\w+)"/g;
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

// ─── Scan a single project directory ─────────────────────────────────────────
// Checks both the project root AND modules/ subdirectory for .tf files.
// Returns null if no .tf files are found anywhere.
function scanProject(projectName) {
  const projectRoot  = path.join(PROJECTS_DIR, projectName);
  const modulesPath  = path.join(projectRoot, 'modules');

  // Gather .tf files from both the root and modules/
  const rootTfFiles    = findTfFiles(projectRoot).filter(f => !f.includes('/modules/'));
  const moduleTfFiles  = findTfFiles(modulesPath);
  const allTfFiles     = [...rootTfFiles, ...moduleTfFiles];

  if (allTfFiles.length === 0) return null;

  const tf       = readTfFiles(allTfFiles);
  const provider = detectProvider(tf);
  if (!provider) return null;

  return {
    projectDirName: projectName,
    name:           dirToName(projectName),
    provider,
    resources:      detectResources(tf),
  };
}

// Deep-equality check for the resource arrays so we only signal a change
// when something actually differs (avoids spurious re-deploys).
function resourcesChanged(oldResources = [], newResources = []) {
  if (oldResources.length !== newResources.length) return true;
  const oldTypes = oldResources.map(r => r.type).sort().join(',');
  const newTypes = newResources.map(r => r.type).sort().join(',');
  return oldTypes !== newTypes;
}

// ─── Main ────────────────────────────────────────────────────────────────────
function main() {
  console.log(`\n🦅 Eagle Eye discovery — ${new Date().toISOString()}`);

  let registry = {};
  if (fs.existsSync(OUTPUT_PATH)) {
    try { registry = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')); } catch {}
  }

  let projectDirs = [];
  if (!fs.existsSync(PROJECTS_DIR)) {
    console.log('⚠️  projects/ directory not found — treating as empty (all projects will be removed)');
  } else {
    projectDirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  }

  const liveOnDisk = new Set(projectDirs);
  let addedCount   = 0;
  let updatedCount = 0;
  let removedCount = 0;

  // ── UPSERT (add new + update existing) ───────────────────────────────────
  for (const projectName of projectDirs) {
    const scanned = scanProject(projectName);

    if (!scanned) {
      // No .tf files found — leave any existing entry alone
      // (manual projects added via the UI should not be wiped)
      continue;
    }

    const existing = registry[projectName];

    if (!existing) {
      // Brand-new project
      registry[projectName] = scanned;
      addedCount++;
      console.log(`  ✅ Added: ${projectName} (provider: ${scanned.provider}, resources: ${scanned.resources.map(r => r.label).join(', ') || 'none'})`);
    } else {
      // Existing project — check whether resources changed
      const changed = existing.provider !== scanned.provider
        || resourcesChanged(existing.resources, scanned.resources);

      if (changed) {
        // Preserve any extra fields the user may have set via the UI
        // (gcpProjectId, dashboardGuid, dashboardLink, knownServices, etc.)
        // but refresh the auto-detected fields.
        registry[projectName] = {
          ...existing,           // keep manual overrides
          ...scanned,            // overwrite auto-detected fields
        };
        updatedCount++;
        console.log(`  🔄 Updated: ${projectName} → resources now: [${scanned.resources.map(r => r.label).join(', ') || 'none'}]`);
      } else {
        console.log(`  — Unchanged: ${projectName}`);
      }
    }
  }

  // ── REMOVE (projects deleted from disk) ──────────────────────────────────
  for (const key of Object.keys(registry)) {
    if (!liveOnDisk.has(key)) {
      delete registry[key];
      removedCount++;
      console.log(`  🗑  Removed: ${key}`);
    }
  }

  // ── Write registry ────────────────────────────────────────────────────────
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(registry, null, 2) + '\n');

  const hasChanges = addedCount > 0 || updatedCount > 0 || removedCount > 0;
  if (hasChanges) {
    fs.writeFileSync(SIGNAL_FILE, 'changed\n');
    console.log(`\n🚀 Changes detected — added: ${addedCount}, updated: ${updatedCount}, removed: ${removedCount}`);
  } else {
    console.log('\nNo changes detected.');
  }
}

main();
