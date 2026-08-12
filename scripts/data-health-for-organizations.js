#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { Pool } = require("pg");

const PROJECT_DIR = path.join(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^[\"']|[\"']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function main() {
  loadEnvFile(path.join(PROJECT_DIR, ".env.production.local"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: "mphub-data-health-runner" });
  let organizations;
  try {
    organizations = (await pool.query(`
      SELECT id, display_name FROM public.organizations WHERE status = 'active' ORDER BY id
    `)).rows;
  } finally {
    await pool.end();
  }

  let failed = 0;
  for (const organization of organizations) {
    const organizationId = Number(organization.id);
    const result = spawnSync(process.execPath, [path.join(PROJECT_DIR, "scripts", "data-health-snapshot.js")], {
      cwd: PROJECT_DIR,
      env: {
        ...process.env,
        MPHUB_ORGANIZATION_ID: String(organizationId),
        MPHUB_ORGANIZATION_NAME: String(organization.display_name || `Organization ${organizationId}`),
      },
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    const targetDir = path.join(PROJECT_DIR, "data", "organizations", String(organizationId));
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    const target = path.join(targetDir, "data-health-cron.json");
    try {
      const payload = JSON.parse((result.stdout || "").trim());
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(payload, null, 2));
      fs.renameSync(temporary, target);
    } catch (error) {
      failed += 1;
      console.error(`Data health failed for organization ${organizationId}: ${result.stderr || error}`);
    }
  }
  if (failed > 0) process.exitCode = 1;
  console.log(`Data health organizations: ${organizations.length - failed}/${organizations.length} successful`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
