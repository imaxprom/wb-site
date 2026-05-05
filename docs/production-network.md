# Production Network

Документ фиксирует фактическую сетевую схему MpHub на production.

## Публичный вход

- Публичный URL: `https://hub.imaxprom.site`
- DNS: `hub.imaxprom.site` -> `46.19.118.18`
- На `46.19.118.18` отвечает внешний `nginx/1.24.0` и терминирует HTTPS
- Сертификат: Let's Encrypt, CN/SAN `hub.imaxprom.site`

Проверка с внешней машины:

```bash
curl -I https://hub.imaxprom.site/login
curl -I https://hub.imaxprom.site/api/auth/me
```

Ожидаемо:

- `/login` -> `200`
- `/api/auth/me` без cookie -> `401`
- `http://hub.imaxprom.site/*` -> `301` на HTTPS

## Runtime на VPS

- SSH alias: `ssh wb-site`
- VPS address in private network: `192.168.55.104`
- Project path: `/home/makson/website`
- PM2 process: `mphub`
- Next.js listens directly on port `80`
- Local nginx on `wb-site`: not used
- Local `443` on `wb-site`: firewall allows it, but no local process listens there
- Background jobs: production `crontab`, not macOS `launchd`

Проверка приложения с самого VPS:

```bash
curl -I http://127.0.0.1/login
curl -I http://192.168.55.104/login
```

Ожидаемо: `200`.

## Важное про health-check

С самого VPS не использовать публичный домен как основной health-check:

```bash
curl -I https://hub.imaxprom.site/login
```

С `wb-site` этот запрос может таймаутиться, хотя сайт снаружи работает. Причина: домен указывает на внешний IP `46.19.118.18`, а обратный маршрут из внутренней сети VPS к внешнему nginx не работает как обычный loopback/hairpin.

Для внутренних cron/watchdog/monitor checks использовать:

```text
http://127.0.0.1
```

или:

```text
http://192.168.55.104
```

Для проверки публичной доступности нужен внешний источник: MacBook, отдельный сервер или внешний uptime-monitor.

`shipment-sync.sh` вызывает закрытый `/api/data/sync` только локально через `127.0.0.1` и передаёт runtime-секрет из `data/cron-secret.txt` в заголовке `x-mphub-cron-secret`. Этот файл не коммитится и должен оставаться с правами `600`. Публичный домен без admin-cookie не должен иметь доступ к этому API.

## Фактическая схема

```text
External user
  -> hub.imaxprom.site / 46.19.118.18
  -> external nginx / HTTPS termination
  -> 192.168.55.104:80
  -> Next.js under PM2 (mphub)
```

## Что не менять без отдельного решения

- Не переводить внутренние health-checks на `https://hub.imaxprom.site`
- Не считать timeout с VPS до `hub.imaxprom.site` признаком падения сайта
- Не менять порт Next.js или схему nginx/HTTPS без отдельного плана миграции

## Production Deploy

Production deploy выполняется из локальной рабочей копии:

```bash
bash scripts/deploy.sh
```

Скрипт делает `rsync` в `wb-site:~/website/` и не переносит runtime-данные:

- `node_modules`
- `.next`
- `.deploy-backups`
- `.git`
- `/data/`
- runtime JSON мониторинга: `status.json`, `repair-state.json`, `repair-log.json`, `data-health-cron.json`, `changes.json`, `auth-status.json`

После синхронизации на VPS запускается:

```bash
cd ~/website && bash scripts/prod-safe-build.sh
```

`prod-safe-build.sh`:

1. сохраняет текущую `.next` в `.deploy-backups/.next-<stamp>`;
2. останавливает PM2 process `mphub`;
3. запускает `npm run build`;
4. перезапускает PM2;
5. проверяет `http://127.0.0.1/login`;
6. при ошибке сборки, старта или health-check восстанавливает предыдущую `.next`.

## Production Cron

Фоновые задачи production управляются `crontab` на `wb-site`:

- `daily-sync.js` — каждый час;
- `sync-weekly-report.js` — Пн-Ср, 10:00-23:00 МСК;
- `shipment-sync.sh` — каждый час, `days=28` по умолчанию;
- `reviews-sync.js` — каждые 10 минут;
- `reviews-complaints.js` — каждые 30 минут;
- `vps-watchdog.py` — каждые 5 минут;
- `data-health-cron.sh` — каждый час;
- `auth-check.js` — ежедневно в 22:00 МСК;
- `paid-storage-sync.js` — ежедневно ночью.
