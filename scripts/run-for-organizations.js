#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");

const PROJECT_DIR = path.join(__dirname, "..");

function loadEnvFile(filePath, target = process.env) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^[\"']|[\"']$/g, "");
    if (/^[A-Z][A-Z0-9_]*$/.test(key) && target[key] === undefined) target[key] = value;
  }
}

function usage() {
  console.error("Usage: node scripts/run-for-organizations.js -- <command> [args...]");
}

function jobName(command, args) {
  return [path.basename(command), ...args.map((arg) => path.basename(String(arg)))].join(" ");
}

function shouldSkipJob(job, capabilities) {
  if (!capabilities.fbo && (job.includes("paid-storage-sync.js") || job.includes("logistics-volume-sync.js"))) {
    return "FBO не используется этим юрлицом";
  }
  if (!capabilities.reviews && (job.includes("reviews-sync.js") || job.includes("reviews-complaints.js"))) {
    return "аккаунт отзывов не настроен";
  }
  return "";
}

async function main() {
  const separator = process.argv.indexOf("--");
  const command = separator >= 0 ? process.argv[separator + 1] : "";
  const args = separator >= 0 ? process.argv.slice(separator + 2) : [];
  if (!command) {
    usage();
    process.exitCode = 2;
    return;
  }

  loadEnvFile(path.join(PROJECT_DIR, ".env.production.local"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    application_name: "mphub-organization-job-runner",
  });
  let organizations;
  try {
    const result = await pool.query(`
      SELECT id, display_name, data_schema
      FROM public.organizations
      WHERE status = 'active'
      ORDER BY id
    `);
    organizations = [];
    for (const row of result.rows) {
      const schema = String(row.data_schema || "");
      if (schema !== "public" && !/^organization_[1-9][0-9]*$/.test(schema)) {
        throw new Error(`Invalid organization schema: ${schema}`);
      }
      const quotedSchema = `"${schema.replace(/"/g, '""')}"`;
      const [settingsResult, reviewsResult] = await Promise.all([
        pool.query(`SELECT key, value FROM ${quotedSchema}.settings WHERE key IN ($1, $2)`, [
          "monitor_fbo_enabled",
          "monitor_reviews_enabled",
        ]),
        pool.query(`SELECT COUNT(*)::int AS cnt FROM ${quotedSchema}.review_accounts WHERE COALESCE(api_key, '') <> ''`),
      ]);
      const settings = new Map(settingsResult.rows.map((item) => [String(item.key), String(item.value).toLowerCase()]));
      const flag = (key, fallback) => settings.has(key) ? settings.get(key) === "true" : fallback;
      organizations.push({
        ...row,
        capabilities: {
          fbo: flag("monitor_fbo_enabled", true),
          reviews: flag("monitor_reviews_enabled", Number(reviewsResult.rows[0]?.cnt || 0) > 0),
        },
      });
    }
  } finally {
    await pool.end();
  }

  let failed = 0;
  const job = jobName(command, args);
  for (const organization of organizations) {
    const organizationId = Number(organization.id);
    const skipReason = shouldSkipJob(job, organization.capabilities);
    if (skipReason) {
      console.log(`[organization-runner] skip org=${organizationId}: ${skipReason}`);
      continue;
    }
    const childEnv = {
      ...process.env,
      MPHUB_ORGANIZATION_ID: String(organizationId),
      MPHUB_ORGANIZATION_NAME: String(organization.display_name || `Organization ${organizationId}`),
    };
    loadEnvFile(
      path.join(PROJECT_DIR, "data", "organizations", String(organizationId), "runtime.env"),
      childEnv,
    );
    console.log(`[organization-runner] start org=${organizationId} ${organization.display_name}`);
    const result = spawnSync(command, args, {
      cwd: PROJECT_DIR,
      env: childEnv,
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) {
      failed += 1;
      console.error(`[organization-runner] failed org=${organizationId} exit=${result.status ?? "spawn-error"}`);
    } else {
      console.log(`[organization-runner] done org=${organizationId}`);
    }
  }

  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[organization-runner] ${error instanceof Error ? error.stack || error.message : error}`);
  process.exitCode = 1;
});
