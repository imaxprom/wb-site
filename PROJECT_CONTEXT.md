# MpHub Project Context

Last verified: 2026-05-27 00:26 MSK from local code, `npm run save-session-state`, production `ssh wb-site`, PM2, crontab and production PostgreSQL.

## Runtime
- Workspace: `/Users/octopus/Projects/website`.
- Production: `ssh wb-site`, `/home/makson/website`, public `https://hub.imaxprom.site`.
- Stack: Next.js 16, TypeScript, Tailwind CSS 4, PostgreSQL in production; SQLite remains as legacy/local fallback for older imports, local snapshots and `weekly_reports.db`.
- Production DB source of truth: PostgreSQL on VM 107 (`192.168.55.107`), database `mphub`; app runtime uses `MPHUB_DB_ENGINE=postgres`.
- Production process: PM2 app `mphub` under user `makson`, bound to `127.0.0.1:3000`; nginx proxies local `:80` to Next.js.
- Local MpHub dev server must use `127.0.0.1:3000`, not the literal `localhost` hostname.
- Preferred full deploy remains `bash scripts/deploy.sh` / `scripts/prod-safe-build.sh`. Do not deploy without explicit user approval.
- `npm run save-session-state` writes `SESSION_STATE.md`; it verifies local legacy SQLite, production PostgreSQL/runtime/crontab and deploy parity dry-run.
- `KnowledgeBase.tsx` is absent. In-app docs are `src/app/docs/page.tsx` + `public/data/docs.json`.

## Production Snapshot
- Verified 2026-05-27 00:26 MSK:
  - `shipment_products`: 30.
  - `shipment_stock`: 5372.
  - `shipment_orders`: 170567, max `2026-05-26T23:48:15`.
  - `paid_storage`: 51586, max date `2026-05-25`.
  - `warehouse_ready_stock`: 127.
  - `warehouse_remains_volume`: 134, max `synced_at=2026-05-26T19:25:41.117Z`.
  - `warehouse_measurements`: 36, max `synced_at=2026-05-26T19:26:00.515Z`, max `measured_at=2026-05-23T13:19:17.441252Z`.
  - `logistics_tariff_cache`: 7, max `synced_at=2026-05-26T20:14:41.759Z`.
  - `reviews`: 147971.
  - `review_complaints`: 572.
  - `sync_status` for reviews: `done`, total/loaded `147971`, message `Отзывы: ожидание лимита WB до 2026-05-26T21:30:01.951Z`, updated `2026-05-27 00:15:56.950751+03`.
  - `reviews_archive_sync_state`: `archive_skip=5000`, `last_status=rate_limited`, `last_success_at=2026-05-26T21:13:52.234Z`, `retry_after_until=2026-05-26T21:30:01.951Z`.
- PM2 `mphub`: online, pid `231999`, restarts `125`, memory about `191-192 MB`.
- Production crontab is in PG mode:
  - `daily-sync-api.sh` every hour;
  - `sync-weekly-report.js` Monday-Wednesday hourly during business window;
  - `shipment-sync.sh` hourly;
  - `reviews-sync.js` every 15 minutes;
  - `reviews-complaints.js` every 30 minutes;
  - `vps-watchdog.py` every 5 minutes;
  - `paid-storage-sync.js` nightly;
  - `logistics-volume-sync.js` remains/measurements at scheduled MSK times.

## Local Snapshot
- Local `data/finance.db` is a legacy/offline snapshot and is stale versus production. Use production PostgreSQL for operational answers.
- Local development should read production PostgreSQL through the configured tunnel when current data is needed. Do not run local background sync scripts unless the user explicitly requests it.

## Current Implemented State
- Production has been migrated to PostgreSQL for application runtime, cron-safe sync scripts and core API reads/writes. Legacy SQLite files remain as backups/import sources, not as production runtime source of truth.
- `/supplies` exists in the left menu after warehouse/stock and shows WB supplies: number/type, planned → actual date, warehouse, status, packed/accepted, expandable article detail. Accepted supplies are cached in DB; draft rows are filtered from the UI.
- `/shipment` → `Товары` uses the left/right `ProductsSplitView`; the old expand-row table is no longer the main tab. Cost table version 1.1 UI changes are deployed.
- `/warehouse` shows the left/right warehouse view with search `Артикул или название`; manual Google Sheets import stores ready boxes in PostgreSQL.
- `/analytics` order chart uses the full orders-funnel source for totals and separate detailed coverage from `shipment_orders`; this explains days where chart total is higher than detailed regional rows.
- `/finance` and forecast use PostgreSQL data. New articles can use fallback forecast logic until enough factual sales history exists; the estimate badge should disappear only when factual clean sales reach the configured threshold.
- Reviews sync uses a slow archive tick every 15 minutes: one WB archive request per cron run, DB state/retry handling for WB `429`, no parallel archive backfill.
- `/api/reviews?sync=true` is intentionally disabled in PostgreSQL mode and returns a controlled response; reviews sync belongs to production cron, not ad-hoc local writes.

## Reviews And Watchdog State
- Account: `ИП Белякова А. Л. / IMSI`, `supplier_id=1166225`.
- WB archive endpoint has a strict practical limit. Current implementation makes at most one archive request per 15-minute cron tick and records `reviews_archive_sync_state`.
- `scripts/reviews-sync.js` has a lock file and database retry state. Do not bypass the lock or launch parallel archive sync.
- Watchdog threshold for `reviews-sync` is `max_age_min=45`, matching the 15-minute cron plus margin.
- `reviews-complaints.js` still runs every 30 minutes and uses Codex gateway for generated complaint text.

## Deployment Caveat
- The local worktree is intentionally dirty after PostgreSQL migration and recent runtime changes. Some changes are deployed to production but not necessarily committed to GitHub.
- Before any new deploy, inspect `git status`, deploy only user-approved scope, and do not revert unrelated dirty files.
- `SESSION_STATE.md` deploy dry-run can be non-empty because local context/docs/runtime migration files differ from production. Treat it as a prompt to inspect, not as automatic permission to deploy.

## Current Caveats
- Production crontab still has old comments around reviews that say hourly, but the active job is `*/15 * * * * ... scripts/reviews-sync.js`.
- `public/data/docs.json` contains some historical code examples mentioning SQLite; the user-facing knowledge sections should state PostgreSQL as the production source of truth.
- Continue using Moscow time (`Europe/Moscow`) in user-facing reports.
