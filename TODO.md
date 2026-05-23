# MpHub TODO

Last updated: 2026-05-23 MSK.

## High Priority
- Use `npm run save-session-state` before context cleanup. In Codex sandbox it may require escalated permissions because it verifies production through `ssh wb-site` and `rsync --dry-run`.
- Keep `scripts/session-state-notes.json` current before saving session state; it drives the generated Current Focus and Continue From Here blocks.
- Verify visually in a real browser that production `/logistics` now shows the deployed local logistics/sidebar changes:
  - split locality/report logic vs RF-only tariff indices in `/api/logistics/products`;
  - `1,00` formatting for localization index;
  - top cards for `Индекс локализации`, `Индекс распределения продаж`, `Локальность отчёта WB`;
  - per-article `ИЛ/ИРП`, RF locality, report locality;
  - hover-expand sidebar, top pin button, text `MPHub` logo, fixed overlay z-index.
- Review the single critical WB measurement:
  - article `178439058`
  - WB latest measurement `3.059 л`
  - card volume `2.5 л`
  - measured at `2026-05-14T23:36:06.281762Z`
- Keep monitoring `data/reviews-sync.log` on production. Do not increase reviews cron frequency while WB feedbacks API is rate-limiting.

## Logistics Follow-Up
- Continue validating the WB localization/index model against user screenshots and exports:
  - report local/nonlocal percentages include CIS/countries and currently match checked WB article examples;
  - tariff indices are calculated on RF-only orders over 13 full completed weeks;
  - do not alter the official formula just to fit a target number.
- Recheck production `/logistics`: compare WB `ИЛ=1,00` and `ИРП=0,09` against the deployed calculation.
- Add an action/workflow for handling critical WB measurements: mark as reviewed, create appeal/task, or store a decision note per article.
- Decide whether the new-measurements window should stay 7 days or become configurable.
- Consider showing a separate “critical only” filter in `/logistics` in addition to the current `Посмотреть новые` filter.
- Confirm with the user whether report volume from `warehouse_remains_volume` should ever drive calculation, or remain an informational comparison column.
- Continue validating warehouse-family matching for sales-based default warehouses, especially Samara/Novosemeykino and long WB warehouse names.

## Monitor/UI
- Verify in browser after deploy that monitor schedules display human-readable values:
  - `каждый час`
  - `каждые 5 мин`
  - `каждые 30 мин`
  - `ежедневно в HH:MM МСК`
- Verify in browser after deploy that the sidebar red triangle badge displays `1` next to `Расчёт логистики` and remains readable in collapsed/sidebar hover mode.
- Verify in browser after deploy that `/logistics` banner shows the 4 current new measurements and that `Посмотреть новые` filters the table correctly.
- Watch production watchdog alerts after the reviews threshold change. Expected state: no false warning at minute 55 for hourly reviews cron.
- Production crontab code and comment are now aligned for `reviews-sync` (`17 * * * *`, hourly at minute 17); continue watching for false alerts.

## Medium Priority
- Consider persisting shipment UI manual export values if users need them to survive reload/navigation. Current V2/V3 manual values are React state for the current page session.
- Add an authenticated endpoint or admin-only UI action for reviews archive backfill instead of SSH-only execution.
- Improve Reviews charts to show complaint breakdown explicitly: submitted, approved, rejected, error.
- Add visible sync error/status for WB `429` in UI, so users do not interpret rate-limit failures as “0 new reviews”.
- Review default `/reviews` filters. It currently opens with ratings `1,2,3`, which can look like missing data if the user expects all reviews.

## Operational Notes
- Do not bypass `reviews-sync.lock`; remove it only after confirming no `node scripts/reviews-sync.js` process is running.
- Production DB and logs are not committed and must remain excluded from deploys.
- Prefer `scripts/deploy.sh` / `prod-safe-build.sh` for broad production deploys.
- For narrow production deploys in the current dirty worktree, use targeted `rsync` only with explicit user approval and a server-side backup.
