#!/usr/bin/env python3
"""
VPS Watchdog — мониторинг сервисов на VPS.
Проверяет PM2 (website), cron-задачи (по логам), отправляет алерты в Telegram.

Запуск: каждые 5 мин через cron
"""

import json
import os
import sys
import subprocess
import fcntl
from pathlib import Path
from datetime import datetime, timedelta, timezone

# ─── Config ──────────────────────────────────────────────────

PROJECT_DIR = Path(__file__).parent.parent
DATA_DIR = PROJECT_DIR / "data"
STATE_PATH = DATA_DIR / "vps-watchdog-state.json"
LOCK_PATH = Path("/tmp/vps-watchdog.lock")
DEPLOY_LOCK_PATH = DATA_DIR / "deploy.lock"
LOG_PATH = DATA_DIR / "watchdog.log"
NOTIFY_SH = PROJECT_DIR / "scripts" / "notify.sh"
CART_STOCK_WORKER_ID = "wb-parser-primary"
CART_STOCK_STALE_SECONDS = 180
CART_STOCK_RESTART_KEY = Path.home() / ".ssh" / "wb_cart_stock_watchdog"
CART_STOCK_RESTART_HOST = "makson@192.168.55.102"

# Cron tasks and their expected intervals (minutes)
CRON_TASKS = {
    "daily-sync": {"log": DATA_DIR / "daily-sync.log", "max_age_min": 120, "name": "Daily Sync"},
    "reviews-sync": {"log": DATA_DIR / "reviews-sync.log", "max_age_min": 45, "name": "Reviews Sync"},
    "reviews-complaints": {"log": DATA_DIR / "reviews-complaints.log", "max_age_min": 45, "name": "Reviews Complaints"},
    "shipment-sync": {"log": DATA_DIR / "shipment-sync.log", "max_age_min": 90, "name": "Shipment Sync"},
    # Weekly-sync запускается Пн-Ср 10-23 МСК. В остальные дни и часы проверка пропускается.
    "weekly-sync": {"log": DATA_DIR / "weekly-sync.log", "max_age_min": 90, "name": "Weekly Sync", "only_dow_msk": [1, 2, 3], "only_hours_msk": list(range(10, 24))},
    # Paid-storage-sync гоняется 02:00 МСК. Проверка — только в окне 03-23 МСК (после запуска).
    "paid-storage-sync": {"log": DATA_DIR / "paid-storage-sync.log", "max_age_min": 1440, "name": "Paid Storage Sync", "only_hours_msk": list(range(3, 24))},
    # Логистические объёмы гоняются после paid-storage, раз в сутки.
    "warehouse-remains-sync": {"log": DATA_DIR / "warehouse-remains-sync.log", "max_age_min": 1440, "name": "Warehouse Remains Sync", "only_hours_msk": list(range(5, 24))},
    "warehouse-measurements-sync": {"log": DATA_DIR / "warehouse-measurements-sync.log", "max_age_min": 1440, "name": "Warehouse Measurements Sync", "only_hours_msk": list(range(5, 24))},
    "auth-check": {"log": DATA_DIR / "auth-check.log", "max_age_min": 1500, "name": "Auth Check"},
    "data-health-cron": {"log": PROJECT_DIR / "public" / "data" / "monitor" / "data-health-cron.json", "max_age_min": 120, "name": "Data Health Cron"},
}

# ─── Logging ─────────────────────────────────────────────────

def log(msg):
    line = f"[{datetime.now().isoformat(timespec='seconds')}] {msg}"
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_PATH, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ─── Lock ────────────────────────────────────────────────────

def acquire_lock():
    try:
        fp = open(LOCK_PATH, "w")
        fcntl.flock(fp, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fp
    except (IOError, OSError):
        return None


# ─── State ───────────────────────────────────────────────────

def load_state():
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text())
        except Exception:
            pass
    return {}


def save_state(state):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2, ensure_ascii=False))


# ─── Telegram ────────────────────────────────────────────────

LEVEL_EMOJI = {"INFO": "\u2705", "WARNING": "\u26a0\ufe0f", "CRITICAL": "\U0001f6a8"}

def send_telegram(level, message):
    """Отправка через notify.sh (SSH-туннель через claude-cli → Germany)."""
    emoji = LEVEL_EMOJI.get(level, "\u2139\ufe0f")
    # Конвертируем простой Markdown *bold* → HTML <b>bold</b> (notify.sh использует HTML)
    import re as _re
    html_message = _re.sub(r"\*([^*]+)\*", r"<b>\1</b>", message)
    text = f"{emoji} <b>VPS Watchdog — {level}</b>\n\n{html_message}"
    try:
        result = subprocess.run(
            ["bash", str(NOTIFY_SH), text],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            log(f"  Telegram [{level}] sent")
        else:
            log(f"  Telegram error: rc={result.returncode}, {result.stderr[:200]}")
    except Exception as e:
        log(f"  Telegram error: {e}")


# ─── Checks ──────────────────────────────────────────────────

def check_pm2():
    """Check PM2 mphub process."""
    try:
        result = subprocess.run(
            ["pm2", "jlist"],
            capture_output=True, text=True, timeout=10,
        )
        procs = json.loads(result.stdout)
        for p in procs:
            if p["name"] == "mphub":
                status = p["pm2_env"]["status"]
                pid = p["pid"]
                restarts = p["pm2_env"]["restart_time"]
                uptime = p["pm2_env"].get("pm_uptime", 0)
                return {
                    "status": status,
                    "pid": pid,
                    "restarts": restarts,
                    "uptime_ms": int(datetime.now().timestamp() * 1000) - uptime if uptime else 0,
                }
        return {"status": "not_found", "pid": 0, "restarts": 0, "uptime_ms": 0}
    except Exception as e:
        return {"status": "error", "pid": 0, "restarts": 0, "error": str(e)}


def check_http():
    """Check if website responds."""
    try:
        result = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "10", "http://127.0.0.1:3000/login"],
            capture_output=True, text=True, timeout=15,
        )
        code = result.stdout.strip()
        return {"ok": code in ("200", "301", "302", "307"), "code": code}
    except Exception as e:
        return {"ok": False, "code": "000", "error": str(e)}


def check_cron_task(task_id, config):
    """Check if cron task ran recently by log file modification time.
    Если у задачи ограничено расписание (only_dow_msk / only_hours_msk),
    вне этого окна проверка пропускается."""
    log_path = config["log"]
    max_age = config["max_age_min"]

    if not log_path.exists():
        return {"ok": False, "reason": "no log file"}

    mtime = datetime.fromtimestamp(log_path.stat().st_mtime)
    age_min = (datetime.now() - mtime).total_seconds() / 60

    # Расписание-aware check: если задача запускается только в определённые
    # дни/часы (МСК), вне окна — skip.
    now_utc = datetime.now(timezone.utc)
    msk_hour = (now_utc.hour + 3) % 24
    # ISO weekday: Пн=1..Вс=7
    msk_dow = (now_utc.weekday() + 1) if (now_utc.hour + 3) < 24 else ((now_utc.weekday() + 1) % 7) + 1

    only_dow = config.get("only_dow_msk")
    only_hours = config.get("only_hours_msk")
    if only_dow and msk_dow not in only_dow:
        return {"ok": True, "age_min": round(age_min), "note": f"out-of-schedule (dow={msk_dow})"}
    if only_hours and msk_hour not in only_hours:
        return {"ok": True, "age_min": round(age_min), "note": f"out-of-schedule (hour={msk_hour})"}

    return {"ok": age_min <= max_age, "age_min": round(age_min)}


def check_disk():
    """Check disk usage."""
    try:
        result = subprocess.run(
            ["df", "--output=pcent", "/"],
            capture_output=True, text=True, timeout=5,
        )
        pct = int(result.stdout.strip().split("\n")[-1].strip().replace("%", ""))
        return {"ok": pct < 90, "percent": pct}
    except Exception:
        return {"ok": True, "percent": 0}


def read_env_value(name):
    """Read one deployment variable without importing the application runtime."""
    for path in (PROJECT_DIR / ".env.production.local", PROJECT_DIR / ".env.local"):
        if not path.exists():
            continue
        try:
            for raw_line in path.read_text().splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                if key.strip() == name:
                    value = value.strip()
                    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                        value = value[1:-1]
                    return value
        except Exception:
            continue
    return os.getenv(name)


def check_cart_stock_worker():
    """Check the worker heartbeat stored by MpHub in PostgreSQL."""
    database_url = read_env_value("DATABASE_URL")
    if not database_url:
        return {"ok": False, "kind": "config", "reason": "DATABASE_URL is unavailable"}
    query = (
        "SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - last_seen_at))::bigint, 999999), "
        "COALESCE(auth_state, 'unknown'), COALESCE(last_error, ''), COALESCE(outbox_count, 0) "
        "FROM wb_cart_stock_worker_state "
        f"WHERE worker_id = '{CART_STOCK_WORKER_ID}' LIMIT 1"
    )
    try:
        result = subprocess.run(
            ["psql", database_url, "-X", "-A", "-t", "-F", "\x1f", "-c", query],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0:
            return {"ok": False, "kind": "database", "reason": result.stderr.strip()[:200]}
        line = result.stdout.strip()
        if not line:
            return {"ok": False, "kind": "missing", "reason": "worker heartbeat row is missing"}
        age_raw, auth_state, last_error, outbox_raw = line.split("\x1f", 3)
        age_seconds = int(age_raw)
        return {
            "ok": age_seconds <= CART_STOCK_STALE_SECONDS,
            "kind": "healthy" if age_seconds <= CART_STOCK_STALE_SECONDS else "stale",
            "age_seconds": age_seconds,
            "auth_state": auth_state,
            "last_error": last_error.replace("\n", " ")[:200],
            "outbox_count": int(outbox_raw),
        }
    except Exception as error:
        return {"ok": False, "kind": "database", "reason": str(error)[:200]}


def restart_cart_stock_worker():
    """Use a restricted SSH key that can only restart this exact service."""
    if not CART_STOCK_RESTART_KEY.exists():
        log("  Cart-stock restart key is missing")
        return False
    try:
        log("  Restarting wb-cart-stock-worker through restricted SSH...")
        result = subprocess.run(
            [
                "ssh", "-i", str(CART_STOCK_RESTART_KEY), "-o", "BatchMode=yes",
                "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=yes",
                CART_STOCK_RESTART_HOST, "restart",
            ],
            capture_output=True, text=True, timeout=20,
        )
        if result.returncode != 0:
            log(f"  Cart-stock restart failed: rc={result.returncode}, {result.stderr[:200]}")
            return False
        time.sleep(15)
        recovered = check_cart_stock_worker()
        ok = recovered.get("ok", False)
        log(f"  Cart-stock restart {'OK' if ok else 'did not restore heartbeat'}")
        return ok
    except Exception as error:
        log(f"  Cart-stock restart error: {error}")
        return False


def restart_pm2():
    """Restart PM2 mphub process."""
    try:
        log("  Restarting PM2 mphub...")
        result = subprocess.run(
            ["pm2", "restart", "mphub"],
            capture_output=True, text=True, timeout=30,
        )
        time.sleep(5)
        check = check_pm2()
        ok = check["status"] == "online"
        log(f"  Restart {'OK' if ok else 'FAILED'}")
        return ok
    except Exception as e:
        log(f"  Restart error: {e}")
        return False


# ─── Main ────────────────────────────────────────────────────

import time

def main():
    log("=== VPS Watchdog started ===")

    state = load_state()
    alerts = []

    if DEPLOY_LOCK_PATH.exists():
        age_min = (datetime.now() - datetime.fromtimestamp(DEPLOY_LOCK_PATH.stat().st_mtime)).total_seconds() / 60
        if age_min <= 120:
            log(f"Deploy lock is active ({round(age_min)} min); skipping watchdog checks")
            state["last_run"] = datetime.now().isoformat()
            save_state(state)
            log("Alerts: 0 | === Watchdog skipped for deploy ===\n")
            return
        log(f"Deploy lock is stale ({round(age_min)} min); continuing checks")

    # 1. Check PM2
    pm2 = check_pm2()
    log(f"PM2: {pm2['status']} (pid={pm2['pid']}, restarts={pm2['restarts']})")

    if pm2["status"] != "online":
        log(f"ALERT: PM2 mphub is {pm2['status']}")
        prev_restarts = state.get("pm2_restart_count", 0)
        if prev_restarts < 3:
            ok = restart_pm2()
            state["pm2_restart_count"] = prev_restarts + 1
            if ok:
                alerts.append(("INFO", "*MpHub Website* — перезапущен и работает."))
            else:
                alerts.append(("CRITICAL", f"*MpHub Website* — не удалось перезапустить! Status: {pm2['status']}"))
        else:
            alerts.append(("CRITICAL", f"*MpHub Website* — упал {prev_restarts}x. Требуется ручное вмешательство."))
    else:
        if state.get("pm2_restart_count", 0) > 0:
            state["pm2_restart_count"] = 0

    # 2. Check HTTP
    http = check_http()
    log(f"HTTP: {http['code']} ({'OK' if http['ok'] else 'FAIL'})")

    if not http["ok"] and pm2["status"] == "online":
        alerts.append(("WARNING", f"*MpHub Website* — PM2 online, но HTTP не отвечает (code={http['code']})."))

    # 3. Check cron tasks
    for task_id, config in CRON_TASKS.items():
        result = check_cron_task(task_id, config)
        if not result["ok"]:
            age = result.get("age_min", "?")
            reason = result.get("reason", f"последний запуск {age} мин назад (макс {config['max_age_min']})")
            alert_key = f"cron_{task_id}_alerted"
            if not state.get(alert_key):
                alerts.append(("WARNING", f"*{config['name']}* — не запускался вовремя. {reason}"))
                state[alert_key] = datetime.now().isoformat()
        else:
            alert_key = f"cron_{task_id}_alerted"
            if state.get(alert_key):
                del state[alert_key]

    # 4. Check authorized WB cart-stock worker end to end
    cart_worker = check_cart_stock_worker()
    if cart_worker.get("kind") in ("healthy", "stale"):
        log(
            "Cart-stock worker: %s (heartbeat=%ss, auth=%s, outbox=%s)"
            % (
                "OK" if cart_worker["ok"] else "STALE",
                cart_worker.get("age_seconds", "?"),
                cart_worker.get("auth_state", "unknown"),
                cart_worker.get("outbox_count", "?"),
            )
        )
    else:
        log(f"Cart-stock worker check failed: {cart_worker.get('reason', 'unknown error')}")

    if not cart_worker.get("ok") and cart_worker.get("kind") in ("stale", "missing"):
        recovered = restart_cart_stock_worker()
        if recovered:
            state.pop("cart_stock_worker_alerted", None)
            state["cart_stock_worker_restart_count"] = 0
            log("Cart-stock worker recovered automatically")
        else:
            restart_count = state.get("cart_stock_worker_restart_count", 0) + 1
            state["cart_stock_worker_restart_count"] = restart_count
            if not state.get("cart_stock_worker_alerted"):
                alerts.append(("CRITICAL", "*Остатки в карточке* — воркер не передаёт heartbeat и не восстановился автоматически."))
                state["cart_stock_worker_alerted"] = datetime.now().isoformat()
    elif cart_worker.get("ok"):
        state.pop("cart_stock_worker_alerted", None)
        state["cart_stock_worker_restart_count"] = 0

    if cart_worker.get("kind") in ("config", "database"):
        if not state.get("cart_stock_monitor_alerted"):
            alerts.append(("WARNING", "*Остатки в карточке* — внешний watchdog не смог проверить heartbeat воркера."))
            state["cart_stock_monitor_alerted"] = datetime.now().isoformat()
    else:
        state.pop("cart_stock_monitor_alerted", None)

    if cart_worker.get("ok") and cart_worker.get("auth_state") == "error":
        if not state.get("cart_stock_auth_alerted"):
            detail = cart_worker.get("last_error") or "покупательская сессия требует обновления"
            alerts.append(("WARNING", f"*Остатки в карточке* — ошибка авторизации WB: {detail}"))
            state["cart_stock_auth_alerted"] = datetime.now().isoformat()
    else:
        state.pop("cart_stock_auth_alerted", None)

    # A fresh heartbeat does not guarantee that the queue is moving. The
    # worker reports HTTP/database failures through last_error while remaining
    # authenticated and online; alert after two consecutive watchdog runs so
    # a server-side claim failure cannot stay hidden behind a healthy heartbeat.
    worker_error = str(cart_worker.get("last_error") or "").strip()
    if cart_worker.get("ok") and worker_error and cart_worker.get("auth_state") != "error":
        error_runs = state.get("cart_stock_server_error_runs", 0) + 1
        state["cart_stock_server_error_runs"] = error_runs
        if error_runs >= 2 and not state.get("cart_stock_server_error_alerted"):
            alerts.append(("WARNING", f"*Остатки в карточке* — воркер не может обработать очередь: {worker_error}"))
            state["cart_stock_server_error_alerted"] = datetime.now().isoformat()
    else:
        state["cart_stock_server_error_runs"] = 0
        state.pop("cart_stock_server_error_alerted", None)

    if cart_worker.get("ok") and cart_worker.get("outbox_count", 0) > 0:
        pending_runs = state.get("cart_stock_outbox_pending_runs", 0) + 1
        state["cart_stock_outbox_pending_runs"] = pending_runs
        if pending_runs >= 3 and not state.get("cart_stock_outbox_alerted"):
            alerts.append(("WARNING", "*Остатки в карточке* — результат остаётся в локальной очереди воркера более 10 минут."))
            state["cart_stock_outbox_alerted"] = datetime.now().isoformat()
    else:
        state["cart_stock_outbox_pending_runs"] = 0
        state.pop("cart_stock_outbox_alerted", None)

    # 5. Check disk
    disk = check_disk()
    log(f"Disk: {disk['percent']}%")
    if not disk["ok"]:
        alerts.append(("WARNING", f"*Диск* — заполнен на {disk['percent']}%."))

    # 6. Send alerts
    for level, msg in alerts:
        send_telegram(level, msg)

    state["last_run"] = datetime.now().isoformat()
    save_state(state)

    log(f"Alerts: {len(alerts)} | === Watchdog done ===\n")


if __name__ == "__main__":
    lock = acquire_lock()
    if not lock:
        sys.exit(0)
    try:
        main()
    finally:
        lock.close()
        try:
            LOCK_PATH.unlink()
        except Exception:
            pass
