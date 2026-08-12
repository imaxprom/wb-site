#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

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
  const baselinePath = process.argv[2];
  const schema = process.argv[3] || "public";
  if (!baselinePath || !/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error("Usage: node scripts/verify-control-baseline.js <database-control.json> [schema]");
  }
  loadEnvFile(path.join(__dirname, "..", ".env.production.local"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const expectedTables = baseline.tables || {};
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, application_name: "mphub-baseline-verifier" });
  const mismatches = [];
  const actual = {};
  try {
    for (const [table, expectedRaw] of Object.entries(expectedTables)) {
      if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`Unsafe table name in baseline: ${table}`);
      const result = await pool.query(`SELECT COUNT(*)::bigint AS count FROM ${schema}.${table}`);
      const count = Number(result.rows[0].count);
      const expected = Number(expectedRaw);
      actual[table] = count;
      if (count !== expected) mismatches.push({ table, expected, actual: count });
    }
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify({ ok: mismatches.length === 0, schema, checked: Object.keys(actual).length, mismatches }, null, 2));
  if (mismatches.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
