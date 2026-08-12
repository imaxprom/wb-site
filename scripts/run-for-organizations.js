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
      SELECT id, display_name
      FROM public.organizations
      WHERE status = 'active'
      ORDER BY id
    `);
    organizations = result.rows;
  } finally {
    await pool.end();
  }

  let failed = 0;
  for (const organization of organizations) {
    const organizationId = Number(organization.id);
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
