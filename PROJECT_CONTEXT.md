# MpHub Project Context

Last verified: 2026-05-23 MSK from local code, local SQLite, production `ssh wb-site`, production SQLite, PM2 and crontab.

## Runtime
- Workspace: `/Users/octopus/Projects/website`.
- Production: `ssh wb-site`, `/home/makson/website`, public `https://hub.imaxprom.site`.
- Stack: Next.js 16, TypeScript, Tailwind CSS 4, SQLite via `better-sqlite3`.
- Production process: PM2 app `mphub` under user `makson`; local app health-check is `http://127.0.0.1:3000/login`.
- Preferred full deploy remains `bash scripts/deploy.sh` / `scripts/prod-safe-build.sh`.
- The local git worktree is dirty, but production code was full-synced from local on 2026-05-23 with `bash scripts/deploy.sh`. Post-deploy `rsync --dry-run` was empty under deploy exclusions.
- `npm run save-session-state` is defined and writes `SESSION_STATE.md` via `scripts/save-session-state.js`.
- `SESSION_STATE.md` is the short restart map. It reads local SQLite and, when SSH is available, production SQLite/runtime/crontab plus deploy parity dry-run. Current Focus / Continue From Here are edited in `scripts/session-state-notes.json`; PM2 is parsed from `pm2 jlist` JSON, and generated warnings call out local/prod data drift, runtime issues, and non-empty deploy dry-run.
- `KnowledgeBase.tsx` is not present in this repository. The current in-app knowledge base is `src/app/docs/page.tsx` + `public/data/docs.json`.

## Production Snapshot
- Production DB: `/home/makson/website/data/finance.db`.
- Verified 2026-05-23 MSK:
  - `shipment_products`: 30 rows.
  - `shipment_stock`: 5163 rows.
  - `shipment_orders`: 165938 rows, max `2026-05-23T10:44:54`.
  - `paid_storage`: 48352 rows, max date `2026-05-22`.
  - `warehouse_remains_volume`: 132 rows, max `synced_at=2026-05-23T01:00:05.143Z`.
  - `warehouse_measurements`: 30 rows, max `synced_at=2026-05-23T01:10:01.674Z`, max `measured_at=2026-05-22T09:17:33.261002Z`.
  - `logistics_tariff_cache`: 3 rows, max `synced_at=2026-05-22T22:45:59.218Z`.
  - `reviews`: 147450 rows.
  - `review_complaints`: 572 rows.
  - `sync_status` for reviews: `done`, `В базе: 147 450 ✅ | Цена и ПВЗ: 17 334`, updated `2026-05-23 07:19:05` UTC.
- Production `shipment_products` includes logistics dimensions: `length_cm`, `width_cm`, `height_cm`.
- PM2 `mphub` verified online; production crontab verified. Crontab comment for reviews now correctly says hourly at minute 17.

## Local DB Snapshot
- Local DB: `data/finance.db`, about 1.8 GB.
- Verified 2026-05-23 MSK:
  - `shipment_products`: 30 rows.
  - `shipment_stock`: 4816 rows.
  - `shipment_orders`: 164375 rows, max `2026-05-21T21:33:16`.
  - `paid_storage`: 5787 rows, max date `2026-04-08`.
  - `warehouse_remains_volume`: 130 rows, max `synced_at=2026-05-21T19:10:17.418Z`.
  - `warehouse_measurements`: 26 rows, max `synced_at=2026-05-21T19:29:23.048Z`, max `measured_at=2026-05-14T23:36:06.281762Z`.
  - `logistics_tariff_cache`: 6 rows, max `synced_at=2026-05-23T07:09:54.981Z`.
  - `reviews`: 141479 rows.
  - `review_complaints`: 421 rows.
- Local `paid_storage`, reviews, stock/orders and measurement tables are stale compared with production. For operational facts use production unless the user asks specifically about local/dev.

## Logistics Current State
- `/logistics` exists locally and on production. As of 2026-05-23, production was full-synced from local with `bash scripts/deploy.sh`; newest formula/UI/sidebar changes are deployed.
- API routes:
  - `/api/logistics/products`
  - `/api/logistics/tariffs`
  - `/api/logistics/alerts`
- `/api/logistics/tariffs` uses WB acceptance coefficients:
  `https://common-api.wildberries.ru/api/tariffs/v1/acceptance/coefficients`.
- Cargo type mapping: `boxTypeID=2` for boxes, `boxTypeID=5` for pallets.
- Product rows aggregate by unique WB article, not size/barcode.
- Displayed logistics calculation uses card dimensions as the main volume:
  `length_cm * width_cm * height_cm / 1000`; fallback is `paid_storage.volume`.
- UI shows card volume, warehouse-remains/report volume, measurements, stock, and warehouse tariff columns. The old visible `Объём из хранения` column was removed from UI.
- Critical measurement alert logic: if the latest WB measurement volume is greater than card volume, the measurement cell is red-highlighted and sidebar badge count increases.
- Current production critical measurement count: 1.
  - Article `178439058`: latest WB measurement `3.059 л`, card volume `2.5 л`, measured at `2026-05-14T23:36:06.281762Z`.
- Production new measurements in last 7 days: 4.
- Logistics auto-sync has run successfully on production after the first scheduled night:
  - remains cron `0 3,6,9,12,15,18 * * *` UTC / 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 MSK.
  - measurements cron `10 3,6,9,12,15,18 * * *` UTC / 06:10, 09:10, 12:10, 15:10, 18:10, 21:10 MSK.

## Logistics Formula/UI Deployed 2026-05-23
- `src/app/api/logistics/products/route.ts` now separates two bases:
  - report locality including CIS/countries, matching WB “Поставки по регионам” local/nonlocal percentages;
  - tariff indices RF-only for `localizationIndex` and `salesDistributionIndexPercent`.
- Tariff indices use 13 full completed weeks, excluding the current week and WB exception categories, without changing the official formula shape.
- Top aggregate `Индекс локализации` displays two digits after comma (`1,00`), matching WB formatting.
- Top aggregate `Индекс распределения продаж` is marked as an RF-orders estimate.
- A separate top card `Локальность отчёта WB` shows report locality including CIS.
- Per-article table now separates tariff `ИЛ/ИРП`, RF locality, and report locality.
- `src/components/ClientShell.tsx` and `src/components/Sidebar.tsx`:
  - sidebar auto-collapses by default and expands on hover;
  - pin button in the top corner fixes/unfixes sidebar;
  - bottom collapse arrow removed;
  - text logo `MPHub` replaces the image logo (`MP` grey, `Hub` purple);
  - collapsed logo is hidden to avoid the left-side artifact near the pin;
  - z-index is raised so expanded sidebar overlays the lower logistics table.
- Local and production `npm run build` passed after these logistics/sidebar/watchdog changes. Production PM2 `mphub` restarted successfully and `/login` and `/logistics` health checks returned 200.

## Reviews And Watchdog State
- Production reviews remain the source of truth.
- Account: `ИП Белякова А. Л. / IMSI`, `supplier_id=1166225`.
- Reviews sync reads both active feedbacks and archive; archive backfill from 2026-05-17 fixed the false post-2026-04-23 graph drop.
- Production reviews cron is intentionally hourly because WB feedbacks API returns `429` under higher frequency:
  `17 * * * * cd /home/makson/website && /usr/bin/node scripts/reviews-sync.js > /dev/null 2>&1`.
- `scripts/reviews-sync.js` has `data/reviews-sync.lock` and backoff; do not bypass the lock or launch parallel archive backfills without checking logs/processes.
- Watchdog false warning was fixed on production:
  - `scripts/vps-watchdog.py` reviews-sync `max_age_min=60`;
  - `public/data/monitor/monitor-registry.json` reviews-sync cron pattern is `17 * * * *`;
  - `scripts/reviews-sync.js` header documents production hourly cron.
- Do not change reviews cron back to 10/15 minutes until WB `429` behavior is rechecked.

## Worktree Caveat
- The local git worktree is dirty with many modified/untracked files, but this is now intentionally reflected on production code after the 2026-05-23 full deploy. Do not confuse git cleanliness with local/prod code parity.
- For future narrow changes, use targeted `rsync` with a server-side backup, then production build and PM2 restart.
- Never revert unrelated dirty files.

## Current Caveats
- In Codex sandbox, `npm run save-session-state` may need escalated permissions because the script calls `ssh wb-site` and `rsync --dry-run` for production verification.
- Keep `scripts/session-state-notes.json` current when the active focus changes; otherwise generated `SESSION_STATE.md` can be technically fresh but operationally stale.
- Local and production SQLite data differ materially.
- `/api/logistics/alerts` is authenticated like other admin APIs; unauthenticated local curl returns redirect/login through middleware.
