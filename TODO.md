# MpHub TODO

Last updated: 2026-06-08 19:40 MSK.

## High Priority
- Before context cleanup or a new handoff, run `npm run save-session-state`, then verify `SESSION_STATE.md` against production if the answer depends on data, cron, PM2, deploy or WB API.
- Keep `scripts/session-state-notes.json` current; it feeds generated Current Focus and Continue From Here.
- Do not switch data direction back to local sync. Production PostgreSQL is the runtime source of truth; local dev should read current data through the configured tunnel and must not run background sync jobs unless explicitly requested.
- Before debugging local empty pages, infinite loading, API `500`, or `Unexpected end of JSON input`, first check the production PostgreSQL tunnel: `nc -zv 127.0.0.1 55432`. If closed, start `ssh -N -L 55432:127.0.0.1:5432 -J proxmox-jump -i ~/.ssh/id_ed25519_backup makson@192.168.55.107`, then restart local Next on `127.0.0.1:3000`.
- Do not deploy without explicit user approval. The worktree contains migration/runtime changes, docs and context updates; inspect deploy scope first.
- Default production deploy is now release-based: `SOURCE_MODE=local bash scripts/release-deploy.sh`. Use `SOURCE_MODE=remote-current bash scripts/release-deploy.sh` only for bootstrap/rebuild from the current production tree without local dirty files. Old `scripts/deploy.sh` / `prod-safe-build.sh` is fallback/clean rebuild.
- After any UI/logic change, run at least `npm run build` before deploy and update `public/data/docs.json` if user-facing behavior changes.

## Production Checks To Keep Watching
- Release deploy:
  - active production symlink should be `/home/makson/current -> /home/makson/releases/<stamp>`;
  - PM2 `mphub` and all cron jobs should run from `/home/makson/current`;
  - `data/deploy.lock` must be cleared after deploy/rollback;
  - keep disk below warning threshold after release retention and old `.deploy-backups` cleanup.
- Weekly Excel reports:
  - WB `archived-excel` returns a ZIP; large reports can be split into several `.xlsx` parts of 20000 rows each;
  - `sync-weekly-report.js` must read every `.xlsx` part in ZIP order before comparing parsed rows with `detailsCount`;
  - `sync-weekly-report.js` treats an already loaded report as incomplete when `reports.rows_count < detailsCount` and reloads it;
  - `sync-weekly-report.js` now has a guard that refuses to delete old rows when parsed Excel rows are below `detailsCount`;
  - `sync-weekly-report.js` validates critical WB headers before deleting old report rows and logs unknown headers/alias usage/control sums for each imported report;
  - `sync-weekly-report.js` writes `data/weekly-sync.log` and PostgreSQL `weekly_import_status`; monitor data-health surfaces the last weekly import status and warnings/errors;
  - after ZIP-part loading is verified on production, affected periods from `2026-04-20` onward can be safely reloaded from full archives.
- Reviews archive sync:
  - active cron is every 15 minutes;
  - expected behavior is one WB archive request per run;
  - `429` should be recorded in `reviews_archive_sync_state` and `sync_status`, not treated as a broken app state.
- Watchdog for `reviews-sync` should use `max_age_min=45`.
- Reviews archive sync already advanced beyond the previous 27.05 snapshot; current generated snapshot is `reviews=148891`, `archive_skip=100000`, `last_status=ok`. Continue monitoring new WB `429` windows and archive progress after `skip=100000`.
- Confirm production monitor/data-health does not show false stale warnings after the PG-mode cron changes.
- Orders funnel:
  - `daily-sync` now refreshes the last 7 closed days from WB Sales Funnel on every run and writes `ordersRefresh` into `daily-sync-status.json`;
  - monitor should show `orders7d✓ checked 7, upd N` in Daily Sync detail;
  - direct WB Sales Funnel API rejected a 30-day range with `invalid start day: excess limit on days`, so do not extend the rewrite window beyond available WB API depth without a new verified source.
- Purchases:
  - `/purchases` is deployed from `src/app/purchases/test/page.tsx`; production/local SHA matched for `src/app/purchases/test/page.tsx`, `src/app/api/purchases/stock/route.ts`, `src/app/purchases/page.tsx` after the latest summary-card fix.
  - After user hard-refresh, visually confirm the six summary cards stay in one horizontal row and that `К закупке в штуках` / `К закупке в пачках` numbers are orange (`tone="need"`).
  - If the user still sees stale color/layout, check browser cache/service assets first; source code on prod currently matches local for purchases.

## PostgreSQL Follow-Up
- Runtime/API and production cron scripts must stay PostgreSQL-only. Do not add file-DB fallback paths back.
- Keep production `.env.production.local` secret. Never print `DATABASE_URL`, JWT secret or WB keys in user-facing answers.
- Consider cleaning production crontab comments so the Reviews Sync heading says every 15 minutes instead of hourly.

## Supplies Follow-Up
- Visually verify production `/supplies` after login:
  - up to 20 latest supplies are fetched, and draft rows are hidden;
  - accepted supplies use cached DB data;
  - `Допринято` appears as supply type, not status;
  - rows expand with article/detail data where WB exposes it.
- Watch accepted-supply cache growth and decide later whether older accepted supplies need a backfill beyond the currently displayed set.

## Shipment/Warehouse/Logistics Follow-Up
- Recheck `/shipment` → `Товары`: version 1.1 layout, small top cards, hover highlight, renamed columns `Размер`/`Баркод`, no duplicate expanded headers.
- Recheck `/shipment` → расчёт отгрузки after future changes: manual `Учитывать отгрузки` should be the only supply deduction path, and regional summary/export columns should stay `Коробов / План / Факт / Нужно`.
- Recheck `/warehouse`: search placeholder `Артикул или название`, selected article table stability, Google Sheets import into PostgreSQL.
- Continue validating warehouse-family matching for sales-based default warehouses, especially Samara/Novosemeykino and long WB warehouse names.
- Visually recheck deployed warehouse/logistics changes after login:
  - `/warehouse` plan tooltip should show active supply deduction as `упаковано - поступило в продажу`;
  - `/logistics` should no longer mark article `178439058` critical because remains volume `0.99 л` confirms correction against card volume `2.5 л`.
- Decide whether the logistics new-measurements window should stay 7 days or become configurable.

## Medium Priority
- Add a visible reviews sync/rate-limit status in UI, so users can see when WB `429` delayed archive sync.
- Improve Reviews charts to show complaint breakdown explicitly: submitted, approved, rejected, error.
- Review default `/reviews` filters. It opens with ratings `1,2,3`, which can look like missing data if the user expects all reviews.
- Hide or relabel the legacy manual full-sync control in reviews account settings: `/api/reviews?sync=true` is intentionally disabled and sync belongs to production cron.
- Consider persisting shipment UI manual export values if users need them to survive reload/navigation.

## Operational Notes
- Rollback path: `bash scripts/release-rollback.sh` switches `/home/makson/current` to the previous release and restarts PM2; with only one release it falls back to legacy `/home/makson/website`.
- Do not bypass `reviews-sync.lock`; remove it only after confirming no `node scripts/reviews-sync.js` process is running.
- Production DB, logs, `.env.production.local`, WB keys and service account files are not committed and must stay excluded from deploys.
- Use `127.0.0.1` for local MpHub dev URLs and health checks; do not use the literal `localhost` hostname.
- Local current-data dev depends on the SSH tunnel to VM107 Postgres. Keep local PG pool small (`PGPOOL_MAX=2`) for tunnel stability; do not interpret local loading/empty data as a frontend bug until the tunnel and API responses are verified.
