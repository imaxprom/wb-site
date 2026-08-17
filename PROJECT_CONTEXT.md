# MpHub Project Context

Last verified: 2026-08-17 15:00 MSK from local code, production `ssh wb-site`, PM2 and production PostgreSQL.

## Runtime

- Workspace: `/Users/octopus/Projects/website`.
- Production: `ssh wb-site`; active symlink `/home/makson/current`; public MpHub `https://hub.imaxprom.site`; isolated warehouse portal `https://fbs.imaxprom.site`.
- Stack: Next.js 16, TypeScript, Tailwind CSS 4, PostgreSQL-only runtime. File-DB fallback is forbidden.
- Production DB: VM 107, database `mphub`. Organization 1 uses schema `public`; organization 2 uses schema `organization_2`. Organization-scoped APIs/files must always run inside verified organization context.
- PM2 application `mphub` runs as `makson` on `127.0.0.1:3000`; local nginx proxies `:80`; external HTTPS terminates on proxy CT 105.
- Production uses immutable release directories behind `/home/makson/current`; after every deploy verify PM2 online, zero unexpected restarts and cwd equal to the active release.
- Preferred deploy is release-based. После baseline cleanup 2026-08-13 локальный Git должен быть источником истины; перед `SOURCE_MODE=local` обязательны clean status, build и пустой deploy parity. Для аварийного восстановления из работающего релиза остаётся `SOURCE_MODE=remote-current`.
- Local current-data development requires the PostgreSQL SSH tunnel on `127.0.0.1:55432` and a small pool: `PGPOOL_MAX=2`. Use `127.0.0.1`, not literal `localhost`.
- Runtime data/env, reports, Android build/APK/signing key, `.codex` и локальные visual test routes намеренно исключены из deploy/parity. Вся остальная source-разница между Git и production считается ошибкой и должна быть разобрана до deploy.
- Permanent photo rule: persisted WB product photos come from official Content API `cards[].photos`. Calculated basket URLs are fallback only and must be HTTP-checked.

## Verified Production Snapshot

- Snapshot from `npm run save-session-state` at 2026-08-12 23:44 MSK:
  - `shipment_products=69`.
  - `shipment_stock=922`.
  - `shipment_orders=263364`, max date `2026-08-12T23:12:27`.
  - `paid_storage=153081`, max date `2026-08-11`.
  - `warehouse_ready_stock=127`.
  - `warehouse_remains_volume=190`, max sync `2026-08-12T18:00:08.518Z`.
  - `warehouse_measurements=81`, max sync `2026-08-12T18:10:01.224Z`.
  - `logistics_tariff_cache=59`, max sync `2026-08-09T22:21:23.151Z`.
  - `reviews=159734`, `review_complaints=612`.
  - review sync status `done`, total/loaded `159734`, updated `2026-08-12 23:45:03 MSK`; текущий цикл ждёт снятия лимита WB до `2026-08-12T20:59:06.780Z`.
- FBS check at 2026-08-12 23:47 MSK:
  - organization 1 / ИП Беликова: 109 supplies (1 open), 1971 known orders, 86 `new`, 8 `confirm`.
  - organization 2 / ИП Made in China: 7 supplies (all closed), 126 known orders, 12 `new`, 0 `confirm`.
  - Both organization schemas have their own FBS supplies/orders/events/print jobs/print agents.
- FBS archive control at 2026-08-16 19:07 MSK after full production backfill:
  - organization 1: 182 supplies, 3659 orders, 14 confirmed return events; zero unchecked compositions, count mismatches, orders without status history, sync errors or unknown statuses.
  - organization 2: 12 supplies, 646 orders; zero unchecked compositions, count mismatches, sync errors or unknown statuses. Three locally retained sold orders absent from both WB order-list endpoints are covered by the local-observation status fallback.
  - Statistics sales cursor is exhausted for both schemas (`cursor_json={}`); further synchronization is incremental.

## FBS Warehouse Portal

- `fbs.imaxprom.site` exposes only warehouse functions with its own login and organization switcher. Primary modules: `/fbs`, `/fbs/archive`, `/fbs/kiz-archive`, `/fbs-stock`, `/printer`; admin can also access employees/settings. `/fbs/kiz-archive` stores applied KIZ values encrypted and isolated by organization, exposes no raw code, and distinguishes local format validation from optional TrueAPI confirmation. Because Honest Sign GTIN can differ from the WB barcode, the first unknown GTIN requires an explicit exact article/size choice and is then remembered in tenant-scoped `fbs_kiz_gtin_mappings`; later codes resolve automatically. Batch printing reserves exact article/size codes in the durable print-agent queue; each confirmed item is removed from the available bank and its encrypted/rendered payload is erased while hashes and audit remain. A paused batch resumes only from an operator-confirmed physical position.
- `/fbs/archive` is an organization-isolated archive of completed and active FBS supplies built on the same operational order/supply tables. It reconciles supply composition against WB `order-ids`, supplements old orders from the monthly archive API, tracks observed WB status history and imports sale/return facts by `srid=rid`. `declined_by_client` is an early cancellation, `canceled_by_client` is a pickup refusal, and a post-sale return is counted only from an explicit sales/financial event. The daily stacked chart and expandable supply rows use this same classification. Historical transition timestamps mean “first observed by MpHub”, not an invented exact WB transition time.
- `scripts/fbs-archive-sync.sh` runs every 10 minutes for both organizations. A full source overlap/backfill runs daily; sales/returns are refreshed no more than every 30 minutes. The sync uses organization-specific advisory locks and state tables, so tenant data cannot cross schemas.
- FBS API tokens are organization-specific and stored under `data/organizations/<id>/wb-fbs-api-key.txt`. Never print them.
- FBS workflow has four stages: new orders, assembly/printing, marking control, shipping. Batch printing is the default assembly mode; individual reprint is available only after initial batch print.
- Required marking is organization-configurable. Honest Mark codes are queued and verified by WB in the background; shipping preflight blocks unverified required marking. WB `deadlineExceeded` is retried automatically without rescanning: the exact live SGTIN is hash-checked, deleted and attached again, with 3 total upload attempts. A third timeout becomes the terminal red status `Не проверено WB`.
- Windows Zebra printing uses the durable print agent and PostgreSQL queue. Agent registration is organization-aware, but one physical agent may serve both legal entities after it has been linked correctly.
- Printer troubleshooting belongs in `/printer`; print jobs remain durable across page reloads and computer restarts. Physical jams still require a person at the printer.
- FBS photos should be cached from official WB card data; generated CDN paths remain fallback only.
- Open-supply membership is reconciled against live WB on sync. After create/add, the app re-reads actual WB membership and persists only attached orders. Partial success is shown explicitly; rejected orders remain in “New”.
- Verified incident fixed 2026-08-12: supply `WB-GI-264192275` (Yekaterinburg, organization 1) now contains order `5472246019`; local count is 1 and live status is `confirm/waiting`.
- PVZ workflow requires cargo-place QR codes before delivery. After delivery it now also requires the main supply QR before allowing “Finish cycle”. WB live endpoint successfully returned the main QR for PVZ supply `WB-GI-264053929`; UI change is included in the clean baseline.
- Organization 2 PVZ supply `WB-GI-264053929`: 36 orders, one cargo place `WB-MP-48974219`, cargo-place QR printed, delivered, main supply QR still not printed at the last read-only check. Opening FBS should resume it on shipping and offer “Print supply QR”. Do not trigger the printer during diagnostics without user approval.
- Separate warehouse Windows remote administration is not implemented. Proposed next step, only after explicit approval and while someone is on site: install Tailscale, enable Windows OpenSSH, create a dedicated admin account, allow key-only access and verify reconnect after reboot. This would let Codex diagnose print agent, Windows spooler and Zebra remotely; physical jams remain local work.

## Android Shipment Scanner

- `android-scanner/` is an independent Android/TC51-TC52 style scanner app, not coupled to MpHub runtime.
- It selects marketplace and mandatory direction, scans product barcode → manual quantity → box barcode, stores shipment/archive details locally and exports XLSX for email.
- Direction has no default and “Start scanning” is blocked until selected. Archive rows are clickable and retain scanned contents. Google/Gmail needed for sending remains enabled on the device; unrelated Google applications and background updates were disabled during optimization.
- The APK and manual build artifacts are local/untracked. Do not include them in a full website deploy by accident.

## Other Stable Project Rules

- Shipment stock source is WB `warehouse_remains`; `stockSkipped:true` preserves the previous `shipment_stock` and must be surfaced as unhealthy for that hour.
- `shipment_orders` uniqueness is WB `order_uid`, not the old barcode/date/warehouse combination.
- `/shipment` calculation supports manual supply deductions and warehouse exclusions. User-site cart stock is not seller API data; its “Total” equals the sum of displayed unique warehouses.
- Finance forecast uses factual current economics. Backpack estimates now use cumulative factual clean sales over the configured lookback/threshold rather than requiring 100 sales in a single day.
- Foreign WB cabinets may return finance Excel files with Chinese headers and operation values. Both daily realization and weekly reference imports normalize them through `scripts/lib/wb-finance-header-aliases.json`, reject unmapped critical columns, and preserve the Russian operation vocabulary used by finance queries. The shared, non-tenant WB tariff cache is read explicitly as `public.logistics_tariff_cache` by forecast; business rows remain tenant-isolated.
- Reviews sync runs every 15 minutes; the top archive request runs at most every 30 minutes and preserves WB `429` retry state. Manual full sync remains disabled in PostgreSQL runtime.
- Codex gateway for complaint generation runs on `codex-cli` and uses `gpt-5.6-sol`; do not expose gateway/auth secrets.
- In-app knowledge base is `src/app/docs/page.tsx` + `public/data/docs.json`; the JSON is required by release deploy.

## Current Caveats

- Git `main` and `origin/main` now contain the full current application baseline. Generated reports and Android build/signing artifacts were moved to `/Users/octopus/Projects/website-artifacts/20260813`; the pre-cleanup archive is `/Users/octopus/Projects/website-backups/website-before-cleanup-20260813-004340.tar.gz`.
- Исторический baseline `672c6ec` заменяется контрольной точкой `production-baseline-2026-08-13`, включающей актуальные production-функции, миграции, FBS portal/print-agent и исходники Android scanner без сборочных артефактов.
- Automatically generated `SESSION_STATE.md` is current for runtime/DB but its Current Focus/Continue sections come from `scripts/session-state-notes.json`; update that JSON first, then rerun `npm run save-session-state`.
- Use Moscow time (`Europe/Moscow`) in user-facing reports.
