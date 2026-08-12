# MpHub TODO

Last updated: 2026-08-13 00:56 MSK.

## High Priority

- Before context cleanup/handoff run `npm run save-session-state`; verify changing facts against production code, PostgreSQL and `ssh wb-site`.
- Keep `scripts/session-state-notes.json` current because it feeds generated `SESSION_STATE.md` focus/continuation sections.
- Поддерживать baseline: clean Git, успешный build и пустой parity перед каждым production deploy.
- Keep organization isolation: organization 1 is `public`, organization 2 is `organization_2`; no FBS queries, agents, queues, tokens or sync state may cross schemas.
- Keep `public/data/docs.json` aligned with user-facing FBS/shipment logic.

## Current FBS Follow-Up

- On organization 2, open PVZ supply `WB-GI-264053929` and print the main supply QR. Cargo-place QR `WB-MP-48974219` is already printed; do not initiate this print remotely without the user.
- Verify the UI then permits “Finish cycle” only after `qr_printed_at` is confirmed by the print agent.
- Monitor future partial WB add failures: actual live membership must be persisted, attached orders move to assembly, rejected orders stay in New, and sync must reconcile open supplies.
- If the user approves remote Windows administration, configure Tailscale + Windows OpenSSH + dedicated key-only admin account on the warehouse computer, then test access after reboot. This is not installed yet.
- For printer failures, inspect print-agent status/log, PostgreSQL print job, Windows spooler and Zebra state before resetting any queue. Never reprint blindly when physical output is unknown.

## Production Checks

- Clean-baseline release `/home/makson/releases/20260812-220325` с marker `production-baseline-2026-08-13-final` проверен; после следующего approved release PM2 должен работать из нового active cwd с нулём неожиданных рестартов.
- После baseline release проверить marker, PM2 cwd/restarts, `/login`, FBS portal login, обе организации и production 404 для debug/test URL.
- Не возвращать в deploy runtime data/env, generated reports, Android build/APK/debug.keystore, `.codex` и локальные visual test routes.
- Production snapshot at 23:44 MSK: shipment products 69, stock 922, orders 263364; reviews 159734; use a fresh snapshot for later factual answers.
- Continue monitoring `warehouse_remains` shipment sync, reviews retry windows, supply reports and data-health. Do not restore file-DB fallbacks or old `supplier/stocks` logic.
- Keep release `data/deploy.lock` cleared after deploy/rollback and retain shared data/env/node_modules outside release deletion.

## Medium Priority

- Add a visible reviews WB rate-limit/retry status if operators still confuse `429` waiting with missing reviews.
- Consider cleaning outdated production crontab comments; active review sync cadence is 15 minutes.
- Decide later whether logistics new-measurement window should be configurable.
- Preserve the independent Android scanner workflow and archive; do not couple it to MpHub unless explicitly requested.

## Operational Notes

- Local current-data development requires the SSH PostgreSQL tunnel on `127.0.0.1:55432`, `PGPOOL_MAX=2`, and local Next on `127.0.0.1:3000`.
- If Turbopack/CSS compilation fails, use webpack dev mode.
- Rollback: `bash scripts/release-rollback.sh`; then verify PM2 cwd and health.
- Never expose DB URLs, JWT secrets, WB tokens, printer-agent tokens or service-account files.
