# MpHub Project Context

Last verified: 2026-06-08 19:46 MSK from `npm run save-session-state`, local code, production `ssh wb-site`, PM2, crontab, release deploy checks and production health endpoints.

## Runtime
- Workspace: `/Users/octopus/Projects/website`.
- Production: `ssh wb-site`, active app symlink `/home/makson/current`, legacy/bootstrap tree `/home/makson/website`, public `https://hub.imaxprom.site`.
- Stack: Next.js 16, TypeScript, Tailwind CSS 4, PostgreSQL-only runtime. No file-DB fallback is allowed.
- Production DB source of truth: PostgreSQL on VM 107 (`192.168.55.107`), database `mphub`; app runtime uses `MPHUB_DB_ENGINE=postgres`.
- Production process: PM2 app `mphub` under user `makson`, cwd under `/home/makson/current` release, bound to `127.0.0.1:3000`; nginx proxies local `:80` to Next.js.
- Local MpHub dev server must use `127.0.0.1:3000`, not the literal `localhost` hostname.
- Local current-data dev requires the PostgreSQL SSH tunnel before starting/checking Next.js: verify `nc -zv 127.0.0.1 55432`; if closed, run `ssh -N -L 55432:127.0.0.1:5432 -J proxmox-jump -i ~/.ssh/id_ed25519_backup makson@192.168.55.107`, then start/restart `npm run dev -- -H 127.0.0.1 -p 3000`. Missing tunnel causes empty data, infinite loading, API `500`, and browser `Unexpected end of JSON input`.
- Preferred deploy is release-based: `SOURCE_MODE=local bash scripts/release-deploy.sh`. Bootstrap/rebuild from current production code uses `SOURCE_MODE=remote-current bash scripts/release-deploy.sh`. Old `bash scripts/deploy.sh` / `scripts/prod-safe-build.sh` remains fallback/clean rebuild only.
- `npm run save-session-state` writes `SESSION_STATE.md`; it verifies production PostgreSQL/runtime/crontab and deploy parity dry-run. Local file-DB snapshot is disabled.
- `KnowledgeBase.tsx` is absent. In-app docs are `src/app/docs/page.tsx` + `public/data/docs.json`.

## Production Snapshot
- Verified 2026-06-08 18:05 MSK:
  - `shipment_products`: 36.
  - `shipment_stock`: 6099.
  - `shipment_orders`: 187781, max `2026-06-08T18:46:44`; `order_uid` is the only active uniqueness rule. The migrated stale old file-DB-style index on `(barcode,date,warehouse)` was removed, and sync deletes an old fallback row when the same order arrives with a real WB identity (`srid`/`gNumber`/`sticker`).
  - `paid_storage`: 65527, max date `2026-06-07`.
  - `warehouse_ready_stock`: 127.
  - `warehouse_remains_volume`: 145, max `synced_at=2026-06-08T15:00:05.560Z`.
  - `warehouse_measurements`: 45, max `synced_at=2026-06-08T15:10:01.147Z`, max `measured_at=2026-06-07T21:12:32.193511Z`.
  - `logistics_tariff_cache`: 16, max `synced_at=2026-06-08T06:33:58.118Z`.
  - `reviews`: 149619.
  - `review_complaints`: 572.
  - `sync_status` for reviews: `done`, total/loaded `149619`, message `Отзывы: WB 429, следующий запрос после 2026-06-08T16:45:02.716Z`, updated `2026-06-08 19:30:02.765811+03`.
  - `reviews_archive_sync_state`: `archive_skip=60000`, `last_status=rate_limited`, `last_success_at=2026-06-08T12:15:07.252Z`, `retry_after_until=2026-06-08T16:45:02.716Z`.
- PM2 `mphub`: online from release `/home/makson/releases/20260608-163549`, pid `101500`, restarts reset to `0` after PM2 delete/start, memory about `177 MB`.
- Release deploy state:
  - `/home/makson/current -> /home/makson/releases/20260608-163549`;
  - `/home/makson/shared` contains shared `data`, env files, `node_modules`, and `.next/cache`;
  - release PM2/preflight startup must source `.env.local` first and `.env.production.local` second, so production `DATABASE_URL` on VM107 overrides local tunnel `127.0.0.1:55432`;
  - production crontab paths now use `/home/makson/current`;
  - first cached webpack compile took `46s` versus previous clean compile around `4.5min`;
  - old `.deploy-backups` were pruned from `21G` to about `1.6G`; disk after cleanup was about `72%` used.
- `daily-sync-status.json` after manual 2026-06-08 run: `today=2026-06-07`, `complete=true`, `orders.value=1706521`, `ordersRefresh={ ok:true, checked:7, updated:7, windowDays:7 }`.
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
- Local file-DB snapshots are disabled for project context and must not be used for operational answers.
- Local development should read production PostgreSQL through the configured tunnel when current data is needed. Do not run local background sync scripts unless the user explicitly requests it.
- For SSH-tunnel stability, keep local PostgreSQL pool small (current local `.env.local`: `PGPOOL_MAX=2`); many parallel API requests through the tunnel can otherwise exhaust/timeout DB connections and make pages look stuck.

## Current Implemented State
- Production has been migrated to PostgreSQL for application runtime, cron-safe sync scripts and core API reads/writes. File-DB fallback paths are removed.
- `/supplies` exists in the left menu after `/warehouse` and before `/purchases`; it fetches up to 20 latest WB supplies and shows number/type, planned → actual date, warehouse, status, packed/accepted, expandable article detail. Accepted supplies are cached in DB; draft rows are filtered from the UI.
- `/purchases` is implemented and deployed. `/purchases/page.tsx` renders the calculator from `src/app/purchases/test/page.tsx`; `/purchases/test` remains available as the same component with test controls/history. It reads purchase stock from Google Sheets via `/api/purchases/stock`, builds article/category settings from warehouse Google sheets, and calculates demand by category.
- Purchase calculation: 30-day order demand from `/api/data/orders-aggregated?days=30` × selected coefficient `1/1.5/2/2.5/3`, minus current WB stock and Google Sheets warehouse stock. Output is in pieces and packs (`12` pieces per pack, rounded up). Size `40-42` is merged into `42-44` only for purchase planning; it remains a separate warehouse/stock position elsewhere.
- Purchase Google stock view keeps small/big size tables side by side from `xl`, and the six top summary cards stay in one horizontal `grid-cols-6` row with `min-w-[1080px]` while stretching by available width. `К закупке в штуках` and `К закупке в пачках` use `tone="need"` orange.
- `/shipment` → `Товары` uses the left/right `ProductsSplitView`; the old expand-row table is no longer the main tab. Cost table version 1.1 UI changes are deployed.
- `/warehouse` shows the left/right warehouse view with search `Артикул или название`; Google Sheets import stores ready boxes in PostgreSQL. On page entry it loads current rows first, then starts the same warehouse sync in the background once; the manual `Обновить` button remains.
- `/warehouse` plan subtracts active supplies as `packed - readyForSale`; items already marked `Поступило в продажу` are assumed to be in WB stock and are not subtracted twice. For boxed supplies where WB exposes ready-for-sale only at supply total level, the ready-for-sale quantity is allocated across barcodes proportionally to packed quantities for planning.
- `/analytics` order chart uses the full orders-funnel source for totals and separate detailed coverage from `shipment_orders`; this explains days where chart total is higher than detailed regional rows.
- `/finance` and forecast use PostgreSQL data. Forecast day rows depend on `shipment_orders`, then day totals scale by `orders_funnel`; if `shipment_orders` stops advancing, the latest dates disappear from forecast. New articles can use fallback forecast logic until enough factual sales history exists; the estimate badge should disappear only when factual clean sales reach the configured threshold. `orders_funnel` is refreshed from WB Sales Funnel for the last 7 closed days on every daily-sync run regardless of `stable`; direct WB API rejected a 30-day range with `invalid start day: excess limit on days`, so older dates are not automatically rewritten.
- `/shipment` V2/V3 summary has manual `Учитывать отгрузки` selection for in-transit supplies. Selected supply composition is deducted by barcode from the current plan; the old automatic deduction from `/supplies` is no longer the planning path. In regional summary/export columns the order is `Коробов / План / Факт / Нужно`; `Факт` is base WB stock by federal district before manual deductions, while `Нужно` is the remaining need after selected supplies.
- `/logistics` critical measurement highlight is active only when the latest WB measurement is above card volume and the warehouse-remains volume is absent or also above card volume. Article `178439058` is no longer critical because measurement `3.059 л` is offset by remains volume `0.99 л` versus card `2.5 л`.
- Reviews sync uses a slow archive tick every 15 minutes: one WB archive request per cron run, DB state/retry handling for WB `429`, no parallel archive backfill.
- `/api/reviews?sync=true` is intentionally disabled and returns a controlled response; reviews sync belongs to production cron, not ad-hoc local writes. UI manual full-sync controls are legacy/no-op until hidden or relabelled.

## Reviews And Watchdog State
- Account: `ИП Белякова А. Л. / IMSI`, `supplier_id=1166225`.
- WB archive endpoint has a strict practical limit. Current implementation makes at most one archive request per 15-minute cron tick and records `reviews_archive_sync_state`.
- `scripts/reviews-sync.js` has a lock file and database retry state. Do not bypass the lock or launch parallel archive sync.
- Watchdog threshold for `reviews-sync` is `max_age_min=45`, matching the 15-minute cron plus margin.
- `reviews-complaints.js` still runs every 30 minutes and uses Codex gateway for generated complaint text.

## Deployment Caveat
- The local worktree is intentionally dirty after PostgreSQL migration and recent runtime/context changes. Before `SOURCE_MODE=local bash scripts/release-deploy.sh`, inspect `git status`, deploy only user-approved scope, and do not revert unrelated dirty files.
- To avoid deploying local dirty files during infrastructure/bootstrap work, use `SOURCE_MODE=remote-current bash scripts/release-deploy.sh`; it builds a new release from the current production tree.
- Rollback command: `bash scripts/release-rollback.sh` from local or `/home/makson/current/scripts/release-rollback.sh` on production. With only one release it falls back to `/home/makson/website`.
- `SESSION_STATE.md` deploy dry-run can be non-empty because local context/docs/runtime migration files differ from production. Treat it as a prompt to inspect, not as automatic permission to deploy.

## Current Caveats
- Production crontab still has old comments around reviews that say hourly, but the active job is `*/15 * * * * ... scripts/reviews-sync.js`.
- `public/data/docs.json` is the in-app knowledge base. Some embedded code examples may lag behind current files; production PostgreSQL and current source code are authoritative.
- Continue using Moscow time (`Europe/Moscow`) in user-facing reports.
