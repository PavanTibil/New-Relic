#!/usr/bin/env node
/**
 * Eagle Eye — Project Discovery Script
 *
 * Directory convention expected in the repo:
 *
 *   projects/
 *   └── <project-name>/
 *       ├── eagle-eye.json        ← optional overrides (name, dashboardGuid, etc.)
 *       └── modules/
 *           └── <module-name>/    ← subdirectories supported!
 *               ├── main.tf
 *               ├── variables.tf
 *               └── ...
 *
 * The script:
 *   1. Finds all projects/<name>/modules/ directories that contain ≥1 .tf file
 *      (recursively — works with projects/demo/modules/ec2/main.tf etc.)
 *   2. Parses those .tf files to detect provider (gcp/aws) and resource types.
 *   3. Reads projects/<name>/eagle-eye.json (if present) for overrides.
 *   4. Merges with the existing auto-discovered-projects.json (never removes entries).
 *   5. Writes the updated file and signals the workflow if anything changed.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Repo root (wherever the script is run from) ──────────────────────────────
const REPO_ROOT    = process.cwd();
const PROJECTS_DIR = path.join(REPO_ROOT, 'projects');
const OUTPUT_PATH  = path.join(REPO_ROOT, 'nerdlets', 'test', 'auto-discovered-projects.json');

// ─── Terraform resource type → Eagle Eye resource definition ─────────────────
const TF_RESOURCE_MAP = {
  // ── GCP ──────────────────────────────────────────────────────────────────
  google_cloud_run_service:        { label: 'Cloud Run',  type: 'gcp_cloudrun', alwaysOn: false, scalesToZero: true },
  google_cloud_run_v2_service:     { label: 'Cloud Run',  type: 'gcp_cloudrun', alwaysOn: false, scalesToZero: true },
  google_cloud_run_v2_job:         { label: 'Cloud Run',  type: 'gcp_cloudrun', alwaysOn: false, scalesToZero: true },
  google_sql_database_instance:    { label: 'Cloud SQL',  type: 'gcp_cloudsql', alwaysOn: true  },
  google_bigquery_dataset:         { label: 'BigQuery',   type: 'gcp_bigquery', alwaysOn: false },
  google_bigquery_table:           { label: 'BigQuery',   type: 'gcp_bigquery', alwaysOn: false },
  google_storage_bucket:           { label: 'GCS',        type: 'gcp_gcs',      alwaysOn: true  },
  google_container_cluster:        { label: 'GKE',        type: 'gcp_gke',      alwaysOn: true  },
  google_pubsub_topic:             { label: 'Pub/Sub',    type: 'gcp_pubsub',   alwaysOn: true  },
  // ── AWS ──────────────────────────────────────────────────────────────────
  aws_instance:                    { label: 'EC2',        type: 'aws_ec2',        alwaysOn: true },
  aws_autoscaling_group:           { label: 'EC2',        type: 'aws_ec2',        alwaysOn: true },
  aws_launch_template:             { label: 'EC2',        type: 'aws_ec2',        alwaysOn: true },
  aws_db_instance:                 { label: 'RDS',        type: 'aws_rds',        alwaysOn: true },
  aws_rds_cluster:                 { label: 'RDS',        type: 'aws_rds',        alwaysOn: true },
  aws_apprunner_service:           { label: 'App Runner', type: 'aws_apprunner',  alwaysOn: true },
  aws_cloudfront_distribution:     { label: 'CloudFront', type: 'aws_cloudfront', alwaysOn: true },
  aws_lambda_function:             { label: 'Lambda',     type: 'aws_lambda',     alwaysOn: false },
  aws_ecs_service:                 { label: 'ECS',        type: 'aws_ecs',        alwaysOn: true },
  aws_ecs_cluster:                 { label: 'ECS',        type: 'aws_ecs',        alwaysOn: true },
  aws_eks_cluster:                 { label: 'EKS',        type: 'aws_eks',        alwaysOn: true },
  aws_s3_bucket:                   { label: 'S3',         type: 'aws_s3',         alwaysOn: true },
  aws_elasticache_cluster:         { label: 'ElastiCache',type: 'aws_elasticache',alwaysOn: true },
  aws_lb:                          { label: 'ALB/NLB',    type: 'aws_alb',        alwaysOn: true },
  aws_alb:                         { label: 'ALB/NLB',    type: 'aws_alb',        alwaysOn: true },
};

const LABEL_TO_RESOURCE = Object.fromEntries(
  Object.values(TF_RESOURCE_MAP).map(r => [r.label, r])
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively find all *.tf file paths under a directory.
 * e.g. modules/ec2/main.tf, modules/rds/main.tf etc.
 */
function findTfFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const walk = (current) => {
      fs.readdirSync(current, { withFileTypes: true }).forEach(entry => {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.tf')) {
          results.push(full);
        }
      });
    };
    walk(dir);
  } catch { /* unreadable dir */ }
  return results;
}

/**
 * Read and concatenate all .tf files from a list of absolute paths.
 */
function readTfFiles(tfFilePaths) {
  return tfFilePaths.map(f => {
    try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
  }).join('\n');
}

/** Determine cloud provider from concatenated TF content. */
function detectProvider(tf) {
  // 1. required_providers block — most explicit
  const reqBlock = (tf.match(/required_providers\s*\{([^}]+)\}/s) || [])[1] || '';
  if (reqBlock.includes('"hashicorp/google"')) return 'gcp';
  if (reqBlock.includes('"hashicorp/aws"'))   return 'aws';

  // 2. resource type prefixes
  if (/resource\s+"google_/.test(tf)) return 'gcp';
  if (/resource\s+"aws_/.test(tf))    return 'aws';

  // 3. provider block name
  if (/provider\s+"google(-beta)?"/.test(tf)) return 'gcp';
  if (/provider\s+"aws"/.test(tf))            return 'aws';

  return null;
}

/** Extract unique Eagle Eye resources from TF content (deduped by type). */
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

/** Extract the first `project = "..."` value found in TF content (GCP only). */
function detectGcpProjectId(tf) {
  const m = tf.match(/\bproject\s*=\s*"([a-z0-9_-]+)"/);
  return m ? m[1] : null;
}

/** Convert a kebab/snake directory name into Title Case display name. */
function dirToName(name) {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

/** Resolve an array of string labels (from eagle-eye.json) into resource objects. */
function resolveResourceLabels(labels) {
  return labels.map(item => {
    if (typeof item === 'object' && item.type) return item;
    const known = LABEL_TO_RESOURCE[item];
    if (known) return { ...known };
    return {
      label:    item,
      type:     'custom_' + String(item).toLowerCase().replace(/[^a-z0-9]/g, '_'),
      alwaysOn: false,
    };
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  console.log(`\n🦅  Eagle Eye discovery — ${new Date().toISOString()}`);
  console.log(`    Repo root : ${REPO_ROOT}`);
  console.log(`    Scan root : ${PROJECTS_DIR}\n`);

  // ── Load existing registry ──────────────────────────────────────────────────
  let registry = {};
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      registry = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    } catch (e) {
      console.warn(`Could not parse existing registry: ${e.message} — starting fresh.`);
    }
  }

  if (!fs.existsSync(PROJECTS_DIR)) {
    console.log('No projects/ directory found — nothing to scan.');
    process.exit(0);
  }

  // ── Find project directories ────────────────────────────────────────────────
  const projectDirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  if (projectDirs.length === 0) {
    console.log('projects/ exists but is empty — nothing to scan.');
    process.exit(0);
  }

  let hasNew = false;

  for (const projectName of projectDirs) {
    const projectPath = path.join(PROJECTS_DIR, projectName);
    const modulesPath = path.join(projectPath, 'modules');

    // ── Recursively find all *.tf files under modules/ ────────────────────────
    const tfFiles = findTfFiles(modulesPath);

    if (tfFiles.length === 0) {
      console.log(`  ⏭  ${projectName}/ — no .tf files found under modules/ (recursive), skipping`);
      continue;
    }

    console.log(`     📂 ${projectName}/ — found ${tfFiles.length} .tf file(s):`);
    tfFiles.forEach(f => console.log(`        ${path.relative(REPO_ROOT, f)}`));

    // ── Already tracked? ──────────────────────────────────────────────────────
    if (registry[projectName]) {
      console.log(`  ✓  ${projectName}/ — already in registry`);
      continue;
    }

    // ── Parse Terraform ───────────────────────────────────────────────────────
    const tf                = readTfFiles(tfFiles);
    const detectedProvider  = detectProvider(tf);
    const detectedResources = detectResources(tf);
    const detectedGcpId     = detectedProvider === 'gcp' ? detectGcpProjectId(tf) : null;

    if (!detectedProvider) {
      console.warn(`  ⚠️  ${projectName}/ — could not determine provider (no google_* or aws_* resources found). Skipping.`);
      continue;
    }

    // ── Read optional eagle-eye.json overrides ────────────────────────────────
    let override = {};
    const overridePath = path.join(projectPath, 'eagle-eye.json');
    if (fs.existsSync(overridePath)) {
      try {
        override = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
        console.log(`     📋 eagle-eye.json found — applying overrides`);
      } catch (e) {
        console.warn(`     ⚠️  Could not parse eagle-eye.json: ${e.message}`);
      }
    }

    // ── Merge: TF detection + eagle-eye.json overrides ───────────────────────
    const provider  = override.provider  || detectedProvider;
    const resources = override.resources
      ? resolveResourceLabels(override.resources)
      : detectedResources;

    const entry = {
      projectDirName: projectName,
      name:           override.name         || dirToName(projectName),
      provider,
      gcpProjectId:   override.gcpProjectId || detectedGcpId || null,
      dashboardGuid:  override.dashboardGuid || null,
      dashboardLink:  override.dashboardLink || null,
      resources,
      knownServices:  override.knownServices || [],
      detectedAt:     new Date().toISOString(),
      detectedFrom:   `projects/${projectName}/modules/ (${tfFiles.length} .tf file${tfFiles.length !== 1 ? 's' : ''} across all subdirectories)`,
      tfFilesFound:   tfFiles.map(f => path.relative(REPO_ROOT, f)),
    };

    registry[projectName] = entry;
    hasNew = true;

    const rLabels = resources.map(r => r.label).join(', ') || '(none detected)';
    console.log(`  ✅ NEW [${provider.toUpperCase()}] "${entry.name}" — resources: ${rLabels}`);
  }

  // ── Write updated registry ──────────────────────────────────────────────────
  const outDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(registry, null, 2) + '\n');
  console.log(`\n📝  Registry written → nerdlets/test/auto-discovered-projects.json`);
  console.log(`    Total entries: ${Object.keys(registry).length}`);

  if (hasNew) {
    fs.writeFileSync('/tmp/eagle-eye-has-new', '1');
    console.log('🚀  New projects found — workflow will redeploy the Nerdpack.\n');
  } else {
    console.log('🟰  No new projects — nothing to redeploy.\n');
  }
}

main();
