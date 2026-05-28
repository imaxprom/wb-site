# MpHub TODO

Last updated: 2026-05-27 00:30 MSK.

## High Priority
- Before context cleanup or a new handoff, run `npm run save-session-state`, then verify `SESSION_STATE.md` against production if the answer depends on data, cron, PM2, deploy or WB API.
- Keep `scripts/session-state-notes.json` current; it feeds generated Current Focus and Continue From Here.
- Do not switch data direction back to local sync. Production PostgreSQL is the runtime source of truth; local dev should read current data through the configured tunnel and must not run background sync jobs unless explicitly requested.
- Do not deploy without explicit user approval. The worktree contains migration/runtime changes, docs and context updates; inspect deploy scope first.
- After any UI/logic change, run at least `npm run build` before deploy and update `public/data/docs.json` if user-facing behavior changes.

## Production Checks To Keep Watching
- Reviews archive sync:
  - active cron is every 15 minutes;
  - expected behavior is one WB archive request per run;
  - `429` should be recorded in `reviews_archive_sync_state` and `sync_status`, not treated as a broken app state.
- Watchdog for `reviews-sync` should use `max_age_min=45`.
- Verify next review ticks after `retry_after_until=2026-05-26T21:30:01.951Z` UTC and confirm the counter moves beyond `reviews=147971` when WB allows the next archive page.
- Confirm production monitor/data-health does not show false stale warnings after the PG-mode cron changes.

## PostgreSQL Follow-Up
- Keep checking any endpoint that still has SQLite fallback logic before changing it: finance reconciliation, weekly Excel imports, WB auth/login helper scripts and old diagnostic scripts.
- `weekly_reports.db` remains a legacy/import source for Excel reconciliation. Do not delete it until the Excel workflow is explicitly migrated.
- Keep production `.env.production.local` secret. Never print `DATABASE_URL`, JWT secret or WB keys in user-facing answers.
- Consider cleaning production crontab comments so the Reviews Sync heading says every 15 minutes instead of hourly.

## Supplies Follow-Up
- Visually verify production `/supplies` after login:
  - 20 non-draft supplies are shown;
  - draft rows are hidden;
  - accepted supplies use cached DB data;
  - `Допринято` appears as supply type, not status;
  - rows expand with article/detail data where WB exposes it.
- Watch accepted-supply cache growth and decide later whether older accepted supplies need a backfill beyond the currently displayed set.

## Shipment/Warehouse/Logistics Follow-Up
- Recheck `/shipment` → `Товары`: version 1.1 layout, small top cards, hover highlight, renamed columns `Размер`/`Баркод`, no duplicate expanded headers.
- Recheck `/warehouse`: search placeholder `Артикул или название`, selected article table stability, Google Sheets import into PostgreSQL.
- Continue validating warehouse-family matching for sales-based default warehouses, especially Samara/Novosemeykino and long WB warehouse names.
- Review the critical WB measurement:
  - article `178439058`;
  - WB latest measurement `3.059 л`;
  - card volume `2.5 л`;
  - measured at `2026-05-14T23:36:06.281762Z`.
- Decide whether the logistics new-measurements window should stay 7 days or become configurable.

## Medium Priority
- Add a visible reviews sync/rate-limit status in UI, so users can see when WB `429` delayed archive sync.
- Improve Reviews charts to show complaint breakdown explicitly: submitted, approved, rejected, error.
- Review default `/reviews` filters. It opens with ratings `1,2,3`, which can look like missing data if the user expects all reviews.
- Consider persisting shipment UI manual export values if users need them to survive reload/navigation.

## Operational Notes
- Do not bypass `reviews-sync.lock`; remove it only after confirming no `node scripts/reviews-sync.js` process is running.
- Production DB, logs, `.env.production.local`, WB keys and service account files are not committed and must stay excluded from deploys.
- Use `127.0.0.1` for local MpHub dev URLs and health checks; do not use the literal `localhost` hostname.
