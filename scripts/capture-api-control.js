#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function loadEnvFile(filePath, override = false) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^[\"']|[\"']$/g, "");
    if (key && (override || process.env[key] === undefined)) process.env[key] = value;
  }
}

function createToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ userId, iat: now, exp: now + 3600 })).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function createOrganizationCookie(organizationId) {
  const signature = crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(`organization:${organizationId}`)
    .digest("base64url");
  return `${organizationId}.${signature}`;
}

function shape(value) {
  if (Array.isArray(value)) return { kind: "array", length: value.length };
  if (value && typeof value === "object") return { kind: "object", keys: Object.keys(value).sort() };
  return { kind: typeof value };
}

async function main() {
  const sourceManifestPath = process.argv[2];
  const outputDir = process.argv[3];
  const baseUrl = (process.argv[4] || "http://127.0.0.1:3000").replace(/\/$/, "");
  const organizationId = Number(process.argv[5] || 1);
  if (!sourceManifestPath || !outputDir) {
    throw new Error("Usage: capture-api-control.js <source-api-manifest.json> <output-dir> [base-url] [organization-id]");
  }
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) throw new Error("Invalid organization id");
  loadEnvFile(path.join(process.cwd(), ".env.local"));
  loadEnvFile(path.join(process.cwd(), ".env.production.local"), true);
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) throw new Error("DATABASE_URL and JWT_SECRET are required");
  const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"));
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: "mphub-api-control" });
  let userId;
  try {
    const result = await pool.query("SELECT id FROM public.users WHERE role = 'admin' ORDER BY id LIMIT 1");
    userId = Number(result.rows[0]?.id);
  } finally {
    await pool.end();
  }
  if (!Number.isSafeInteger(userId)) throw new Error("Admin user not found");
  const token = createToken(userId);
  const organizationCookie = createOrganizationCookie(organizationId);
  const manifest = [];

  for (const source of sourceManifest) {
    const url = source.url || `/${String(source.name).replace(/^public\//, "")}`;
    const response = await fetch(baseUrl + url, {
      headers: {
        cookie: `mphub-token=${token}; mphub-org=${organizationCookie}`,
        accept: "application/json",
      },
      redirect: "manual",
    });
    const raw = await response.text();
    const safeName = String(source.name).replace(/[^a-zA-Z0-9._-]+/g, "_");
    fs.writeFileSync(path.join(outputDir, `${safeName}.json`), raw);
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    manifest.push({
      name: source.name,
      url,
      status: response.status,
      bytes: Buffer.byteLength(raw),
      sha256: crypto.createHash("sha256").update(raw).digest("hex"),
      shape: shape(parsed),
    });
  }
  fs.writeFileSync(path.join(outputDir, "api-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({
    ok: manifest.every((item) => item.status === 200),
    endpoints: manifest.length,
    organizationId,
    outputDir,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
