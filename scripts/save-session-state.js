#!/usr/bin/env node
/**
 * Generate SESSION_STATE.md for a quick restart map.
 *
 * This file is intentionally a snapshot, not the source of truth.
 * It verifies production PostgreSQL/runtime state on wb-site. Local runtime
 * data must come from PostgreSQL through the SSH tunnel.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "SESSION_STATE.md");
const NOTES_PATH = path.join(ROOT, "scripts", "session-state-notes.json");
const PROD_DIR = "/home/makson/current";

function moscowParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

function dash(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function localSnapshot() {
  return {
    ok: false,
    engine: "postgres-through-ssh-tunnel",
    error: "Local file-DB snapshot is disabled; use production PostgreSQL via 127.0.0.1:55432 tunnel",
  };
}

const REMOTE_DB_SCRIPT = `
const fs = require("fs");
${dash.toString()}
async function pgSnapshot() {
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    application_name: "mphub-session-state",
  });
  const one = async (sql) => {
    const result = await pool.query(sql);
    return result.rows[0] || null;
  };
  try {
    return {
      ok: true,
      engine: "postgres",
      shipment_products: Number((await one("SELECT COUNT(*) AS c FROM shipment_products")).c),
      shipment_stock: Number((await one("SELECT COUNT(*) AS c FROM shipment_stock")).c),
      shipment_orders: await one("SELECT COUNT(*)::int AS c, MAX(date) AS max_date FROM shipment_orders"),
      paid_storage: await one("SELECT COUNT(*)::int AS c, MAX(date) AS max_date FROM paid_storage"),
      warehouse_ready_stock: Number((await one("SELECT COUNT(*) AS c FROM warehouse_ready_stock")).c),
      warehouse_remains_volume: await one("SELECT COUNT(*)::int AS c, MAX(synced_at) AS max_synced FROM warehouse_remains_volume"),
      warehouse_measurements: await one("SELECT COUNT(*)::int AS c, MAX(synced_at) AS max_synced, MAX(measured_at) AS max_measured FROM warehouse_measurements"),
      logistics_tariff_cache: await one("SELECT COUNT(*)::int AS c, MAX(synced_at) AS max_synced FROM logistics_tariff_cache"),
      reviews: Number((await one("SELECT COUNT(*) AS c FROM reviews")).c),
      review_complaints: Number((await one("SELECT COUNT(*) AS c FROM review_complaints")).c),
      sync_status: await one("SELECT status, total, loaded, message, updated_at FROM sync_status WHERE id = 1"),
      reviews_archive_sync_state: await one("SELECT archive_skip, retry_after_until, last_request_at, last_success_at, last_status, last_message, fetched_count, upserted_count, inserted_count FROM reviews_archive_sync_state WHERE id = 1").catch(() => null),
    };
  } finally {
    await pool.end();
  }
}
(async () => {
  if (process.env.MPHUB_DB_ENGINE && process.env.MPHUB_DB_ENGINE !== "postgres") {
    throw new Error("MpHub runtime is PostgreSQL-only; MPHUB_DB_ENGINE must be postgres");
  }
  console.log(JSON.stringify(await pgSnapshot()));
})().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
`;

function tryExec(label, fn) {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    const text = [
      error.stderr?.toString(),
      error.stdout?.toString(),
      error.message,
    ].filter(Boolean).join("\n");
    const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) || error.message;
    return { ok: false, error: `${label}: ${firstLine}` };
  }
}

function productionDbSnapshot() {
  const result = tryExec("production DB snapshot", () => execFileSync(
    "ssh",
    ["wb-site", `cd ${PROD_DIR} && set -a && . ./.env.production.local && set +a && node`],
    { input: REMOTE_DB_SCRIPT, encoding: "utf8", timeout: 15000 },
  ));
  if (!result.ok) return { ok: false, error: result.error };
  try {
    return JSON.parse(result.value);
  } catch (error) {
    return { ok: false, error: `production DB JSON parse: ${error.message}` };
  }
}

function productionRuntime() {
  const script = [
    "set -e",
    "echo '---PM2---'",
    "(pm2 jlist 2>/dev/null || printf '[]') | base64 | tr -d '\\n'",
    "echo",
    "echo '---HEALTH---'",
    "curl --max-time 10 -sS -o /dev/null -w 'login:%{http_code}\\n' http://127.0.0.1:3000/login || true",
    "curl --max-time 10 -sS -o /dev/null -w 'logistics:%{http_code}\\n' http://127.0.0.1:3000/logistics || true",
    "echo '---CRON---'",
    "crontab -l 2>/dev/null | grep -E 'daily-sync-api|sync-weekly-report|reviews-sync|reviews-complaints|shipment-sync|logistics-volume-sync|vps-watchdog|paid-storage-sync|data-health-cron' || true",
  ].join("\n");

  const result = tryExec("production runtime", () => execFileSync(
    "ssh",
    ["wb-site", script],
    { encoding: "utf8", timeout: 15000 },
  ));
  if (!result.ok) return { ok: false, error: result.error };

  const pm2Raw = (result.value.match(/---PM2---\n([\s\S]*?)\n---HEALTH---/) || [])[1] || "[]";
  const healthRaw = (result.value.match(/---HEALTH---\n([\s\S]*?)\n---CRON---/) || [])[1] || "";
  const cronRaw = (result.value.match(/---CRON---\n([\s\S]*)$/) || [])[1] || "";
  let mphub = null;
  let pm2ParseError = "";
  try {
    const decoded = Buffer.from(pm2Raw.trim(), "base64").toString("utf8");
    const rows = JSON.parse(decoded);
    mphub = rows.find((row) => row.name === "mphub") || null;
  } catch (error) {
    pm2ParseError = error.message;
  }

  return { ok: true, mphub, pm2ParseError, health: healthRaw.trim(), cron: cronRaw.trim() };
}

function gitStatusShort() {
  const result = tryExec("git status", () => execFileSync(
    "git",
    ["status", "--short"],
    { cwd: ROOT, encoding: "utf8", timeout: 10000 },
  ));
  return result.ok ? result.value.trim() : result.error;
}

function rsyncDryRunStatus() {
  const args = [
    "-azn",
    "--itemize-changes",
    "--omit-dir-times",
    "--delete",
    "--exclude=node_modules",
    "--exclude=.next",
    "--exclude=.venv",
    "--exclude=.npm-cache",
    "--exclude=.deploy-backups",
    "--exclude=.git",
    "--exclude=.codex",
    "--exclude=.DS_Store",
    "--exclude=.env.local",
    "--exclude=.env.production.local",
    "--exclude=.env.production.local.*",
    "--exclude=__pycache__/",
    "--exclude=*.pyc",
    "--exclude=/0",
    "--exclude=/android-scanner/",
    "--exclude=/data/",
    "--exclude=/reports/",
    "--exclude=/commission-*.pdf",
    "--exclude=/fbs-pvz-dispute-report-*.html",
    "--exclude=/fbs-pvz-dispute-report-*.pdf",
    "--exclude=/finance-*-analysis-*.html",
    "--exclude=/finance-*-analysis-*.json",
    "--exclude=/finance-*-analysis-*.pdf",
    "--exclude=/wb-loss-warehouses-report-*.html",
    "--exclude=/wb-loss-warehouses-report-*.json",
    "--exclude=/wb-loss-warehouses-report-*.pdf",
    "--exclude=/wb-support-appeal-*.html",
    "--exclude=/wb-support-appeal-*.pdf",
    "--exclude=/upload-tab-dates.png",
    "--exclude=/next-env.d.ts",
    "--exclude=/tsconfig.tsbuildinfo",
    "--exclude=/public/data/release-marker.json",
    "--exclude=/src/app/debug/",
    "--exclude=/src/app/finance/settings/test/",
    "--exclude=/src/app/shipment/products-test/",
    "--exclude=/src/app/warehouse/test/",
    "--exclude=/src/app/fbs/assembly-datamatrix-test/",
    "--exclude=/src/app/fbs/assembly-status-compact-test/",
    "--exclude=/src/app/fbs/assembly-status-supply-row-test/",
    "--exclude=/src/app/fbs/assembly-test/",
    "--exclude=/src/app/fbs/batch-marking-modal-test/",
    "--exclude=/src/app/fbs/grouped-assembly-test/",
    "--exclude=/src/app/fbs/marking-stage-test/",
    "--exclude=/src/app/fbs/pair-scanning-variants-test/",
    "--exclude=/src/app/fbs/print-button-test/",
    "--exclude=/src/app/api/fbs/grouped-assembly-test/",
    "--exclude=public/data/monitor/status.json",
    "--exclude=public/data/monitor/repair-state.json",
    "--exclude=public/data/monitor/repair-log.json",
    "--exclude=public/data/monitor/data-health-cron.json",
    "--exclude=public/data/monitor/changes.json",
    "--exclude=public/data/monitor/auth-status.json",
    "-e",
    "ssh",
    `${ROOT}/`,
    "wb-site:~/current/",
  ];
  const result = tryExec("rsync dry-run", () => execFileSync("rsync", args, { encoding: "utf8", timeout: 20000 }));
  if (!result.ok) return result.error;
  return result.value.trim() || "empty; production code matches local under deploy exclusions";
}

function readSessionNotes() {
  const fallback = {
    currentFocus: [
      "Production code was full-synced from local on 2026-05-23; latest logistics/sidebar formula changes are deployed.",
      "`/logistics` uses split report locality vs RF-only tariff indices.",
      "Tariff `ИЛ/ИРП` use 13 full completed weeks excluding the current week and WB exception categories.",
      "Sidebar auto-collapses by default, expands on hover, and can be pinned from the top button.",
      "Reviews sync is intentionally hourly at minute 17 because WB feedbacks API rate-limits with `429`; watchdog threshold is `max_age_min=60`.",
    ],
    continueFromHere: [
      "Visually verify production `/logistics` in browser: top cards, `1,00` formatting, per-article `ИЛ/ИРП`, sidebar hover/pin behavior, and table overlay.",
      "Compare deployed calculation with WB values: `ИЛ=1,00`, `ИРП=0,09`.",
      "Keep monitoring production `data/reviews-sync.log`; do not increase reviews sync frequency until WB `429` behavior is rechecked.",
      "Review critical WB measurement article `178439058`: WB latest measurement `3.059 л` vs card volume `2.5 л`.",
    ],
  };
  if (!fs.existsSync(NOTES_PATH)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(NOTES_PATH, "utf8"));
    return {
      currentFocus: Array.isArray(parsed.currentFocus) && parsed.currentFocus.length > 0
        ? parsed.currentFocus
        : fallback.currentFocus,
      continueFromHere: Array.isArray(parsed.continueFromHere) && parsed.continueFromHere.length > 0
        ? parsed.continueFromHere
        : fallback.continueFromHere,
    };
  } catch (error) {
    return {
      currentFocus: [...fallback.currentFocus, `Session notes parse warning: ${error.message}`],
      continueFromHere: fallback.continueFromHere,
    };
  }
}

function mdList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function parseTime(value) {
  if (!value) return null;
  const text = String(value).replace(" ", "T");
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function describeDiff(name, localValue, prodValue) {
  if (localValue === null || localValue === undefined || prodValue === null || prodValue === undefined) {
    return null;
  }
  if (localValue === prodValue) return null;
  const diff = prodValue - localValue;
  const sign = diff > 0 ? "+" : "";
  return `${name}: local=${localValue}, prod=${prodValue} (${sign}${diff} on prod)`;
}

function snapshotWarnings(local, prod, runtime, dryRun) {
  const warnings = [];

  if (!prod?.ok) warnings.push(`Production DB snapshot unavailable: ${dash(prod?.error)}`);
  if (!local?.ok) warnings.push(`Local DB snapshot skipped: ${dash(local?.error)}`);

  if (local?.ok && prod?.ok) {
    [
      ["shipment_stock", local.shipment_stock, prod.shipment_stock],
      ["shipment_orders", local.shipment_orders?.c, prod.shipment_orders?.c],
      ["paid_storage", local.paid_storage?.c, prod.paid_storage?.c],
      ["warehouse_remains_volume", local.warehouse_remains_volume?.c, prod.warehouse_remains_volume?.c],
      ["warehouse_measurements", local.warehouse_measurements?.c, prod.warehouse_measurements?.c],
      ["logistics_tariff_cache", local.logistics_tariff_cache?.c, prod.logistics_tariff_cache?.c],
      ["reviews", local.reviews, prod.reviews],
      ["review_complaints", local.review_complaints, prod.review_complaints],
    ].forEach(([name, localValue, prodValue]) => {
      const diff = describeDiff(name, localValue, prodValue);
      if (diff) warnings.push(diff);
    });

    [
      ["shipment_orders max date", local.shipment_orders?.max_date, prod.shipment_orders?.max_date],
      ["paid_storage max date", local.paid_storage?.max_date, prod.paid_storage?.max_date],
      ["warehouse_remains_volume max synced", local.warehouse_remains_volume?.max_synced, prod.warehouse_remains_volume?.max_synced],
      ["warehouse_measurements max synced", local.warehouse_measurements?.max_synced, prod.warehouse_measurements?.max_synced],
    ].forEach(([name, localDate, prodDate]) => {
      const localTime = parseTime(localDate);
      const prodTime = parseTime(prodDate);
      if (localTime !== null && prodTime !== null && localTime < prodTime) {
        const hours = Math.round((prodTime - localTime) / 36e5);
        warnings.push(`${name}: local is behind production by about ${hours}h`);
      }
    });
  }

  if (!runtime?.ok) {
    warnings.push(`Production runtime unavailable: ${dash(runtime?.error)}`);
  } else {
    const pm2Status = runtime.mphub?.pm2_env?.status;
    if (pm2Status !== "online") warnings.push(`PM2 mphub is ${dash(pm2Status)}`);
    const badHealth = runtime.health
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => {
        const code = line.split(":").pop();
        return !["200", "307", "401"].includes(code);
      });
    badHealth.forEach((line) => warnings.push(`Health check is unexpected: ${line}`));
  }

  if (dryRun && !dryRun.startsWith("empty;")) {
    warnings.push("Deploy parity dry-run is not empty; review rsync output before assuming local/prod code parity.");
  }

  return warnings;
}

function formatSnapshot(name, snap) {
  if (!snap?.ok) return `### ${name}\n\n- engine: ${dash(snap?.engine)}\n- unavailable: ${dash(snap?.error)}`;
  return `### ${name}

- engine: ${dash(snap.engine || "-")}
- shipment_products: ${dash(snap.shipment_products)}
- shipment_stock: ${dash(snap.shipment_stock)}
- shipment_orders: ${dash(snap.shipment_orders?.c)}, max date ${dash(snap.shipment_orders?.max_date)}
- paid_storage: ${dash(snap.paid_storage?.c)}, max date ${dash(snap.paid_storage?.max_date)}
- warehouse_ready_stock: ${dash(snap.warehouse_ready_stock)}
- warehouse_remains_volume: ${dash(snap.warehouse_remains_volume?.c)}, max synced ${dash(snap.warehouse_remains_volume?.max_synced)}
- warehouse_measurements: ${dash(snap.warehouse_measurements?.c)}, max synced ${dash(snap.warehouse_measurements?.max_synced)}, max measured ${dash(snap.warehouse_measurements?.max_measured)}
- logistics_tariff_cache: ${dash(snap.logistics_tariff_cache?.c)}, max synced ${dash(snap.logistics_tariff_cache?.max_synced)}
- reviews: ${dash(snap.reviews)}
- review_complaints: ${dash(snap.review_complaints)}
- sync_status: ${dash(snap.sync_status?.status)}, total=${dash(snap.sync_status?.total)}, loaded=${dash(snap.sync_status?.loaded)}, updated_at=${dash(snap.sync_status?.updated_at)}
- sync message: ${dash(snap.sync_status?.message)}
- reviews archive state: skip=${dash(snap.reviews_archive_sync_state?.archive_skip)}, status=${dash(snap.reviews_archive_sync_state?.last_status)}, retry_after=${dash(snap.reviews_archive_sync_state?.retry_after_until)}, last_success=${dash(snap.reviews_archive_sync_state?.last_success_at)}`;
}

function main() {
  const now = moscowParts();
  const local = localSnapshot();
  const prod = productionDbSnapshot();
  const runtime = productionRuntime();
  const status = gitStatusShort();
  const dryRun = rsyncDryRunStatus();
  const notes = readSessionNotes();
  const warnings = snapshotWarnings(local, prod, runtime, dryRun);

  const pm2Line = runtime.ok && runtime.mphub
    ? [
        `name=${runtime.mphub.name}`,
        `status=${runtime.mphub.pm2_env?.status || "-"}`,
        `pid=${runtime.mphub.pid || "-"}`,
        `restarts=${runtime.mphub.pm2_env?.restart_time ?? "-"}`,
        `uptime=${runtime.mphub.pm2_env?.pm_uptime ? new Date(runtime.mphub.pm2_env.pm_uptime).toISOString() : "-"}`,
        `memory=${runtime.mphub.monit?.memory ? `${Math.round(runtime.mphub.monit.memory / 1024 / 1024)} MB` : "-"}`,
      ].join(", ")
    : runtime.ok && runtime.pm2ParseError
      ? `unavailable: PM2 JSON parse failed: ${runtime.pm2ParseError}`
    : `unavailable: ${dash(runtime.error)}`;

  const contents = `# MpHub — Session State

Updated: ${now.date} ${now.time} MSK

Purpose: short starting map for a new session. This file is generated by \`npm run save-session-state\`. It is not the source of truth. Always verify with code, production \`ssh wb-site\`, and the active DB before changing behavior.

## Read First

1. \`CLAUDE.md\` — project rules, deploy/runtime constraints, hard rules.
2. \`SESSION_STATE.md\` — quick current state and next step.
3. \`PROJECT_CONTEXT.md\` — detailed current project context.
4. \`TODO.md\` — active backlog.
5. \`src/app/docs/page.tsx\` + \`public/data/docs.json\` — in-app knowledge base. \`KnowledgeBase.tsx\` is absent in this repo.
6. \`~/.codex/memories/\` — long-term Codex memories, especially \`mphub-fbs-current-context.md\`, \`mphub-purchases-current-context.md\`, \`mphub-shipment-logistics-current-context.md\`, \`mphub-reviews-current-context.md\`, \`mphub-prod-ops.md\`, \`moscow-time.md\`.

## Project

- Workspace: \`/Users/octopus/Projects/website\`
- Production: \`ssh wb-site\`, active \`${PROD_DIR}\`, legacy/bootstrap \`/home/makson/website\`, public \`https://hub.imaxprom.site\`
- Stack: Next.js 16, TypeScript, Tailwind CSS 4, PostgreSQL-only runtime.
- Main runtime DB: production PostgreSQL on VM 107; local/dev reads it through the configured tunnel when needed. File-DB fallback is removed.
- Deploy: \`SOURCE_MODE=local bash scripts/release-deploy.sh\` → build new release → preflight → switch \`/home/makson/current\`; old \`scripts/deploy.sh\` is fallback/clean rebuild only.
- Editable handoff notes: \`scripts/session-state-notes.json\` feeds Current Focus and Continue From Here.

## Current Focus

${mdList(notes.currentFocus)}

## Snapshot Warnings

${warnings.length > 0 ? mdList(warnings) : "- No runtime/deploy-parity warnings detected by the generator."}

## Verified Data

${formatSnapshot("Production DB", prod)}

${formatSnapshot("Local DB", local)}

## Production Runtime

- PM2 mphub: ${pm2Line}
- Health:
${runtime.ok ? runtime.health.split("\n").map((line) => `  - ${line}`).join("\n") : `  - ${dash(runtime.error)}`}
- Relevant crontab:
${runtime.ok && runtime.cron ? runtime.cron.split("\n").map((line) => `  - ${line}`).join("\n") : "  - unavailable"}
- Deploy parity dry-run: ${dryRun}

## Git/Worktree

\`\`\`
${status || "clean"}
\`\`\`

## Continue From Here

${mdList(notes.continueFromHere)}
`;

  fs.writeFileSync(OUT_PATH, contents);
  console.log(`Updated ${path.relative(ROOT, OUT_PATH)} at ${now.date} ${now.time} MSK`);
}

main();
