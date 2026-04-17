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
from datetime import datetime, timedelta

# ─── Config ──────────────────────────────────────────────────

PROJECT_DIR = Path(__file__).parent.parent
DATA_DIR = PROJECT_DIR / "data"
STATE_PATH = DATA_DIR / "vps-watchdog-state.json"
LOCK_PATH = Path("/tmp/vps-watchdog.lock")
LOG_PATH = DATA_DIR / "watchdog.log"
NOTIFY_SH = PROJECT_DIR / "scripts" / "notify.sh"

# Cron tasks and their expected intervals (minutes)
CRON_TASKS = {
    "daily-sync": {"log": DATA_DIR / "daily-sync.log", "max_age_min": 120, "name": "Daily Sync"},
    "reviews-sync": {"log": DATA_DIR / "reviews-sync.log", "max_age_min": 15, "name": "Reviews Sync"},
    "reviews-complaints": {"log": DATA_DIR / "reviews-complaints.log", "max_age_min": 45, "name": "Reviews Complaints"},
    "shipment-sync": {"log": DATA_DIR / "shipment-sync.log", "max_age_min": 360, "name": "Shipment Sync"},
    "weekly-sync": {"log": DATA_DIR / "weekly-sync.log", "max_age_min": 1500, "name": "Weekly Sync"},
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
            ["sudo", "pm2", "jlist"],
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
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "10", "http://localhost:80"],
            capture_output=True, text=True, timeout=15,
        )
        code = result.stdout.strip()
        return {"ok": code in ("200", "301", "302", "307"), "code": code}
    except Exception as e:
        return {"ok": False, "code": "000", "error": str(e)}


def check_cron_task(task_id, config):
    """Check if cron task ran recently by log file modification time."""
    log_path = config["log"]
    max_age = config["max_age_min"]

    if not log_path.exists():
        return {"ok": False, "reason": "no log file"}

    mtime = datetime.fromtimestamp(log_path.stat().st_mtime)
    age_min = (datetime.now() - mtime).total_seconds() / 60

    # During non-working hours (23:00-06:00 UTC = 02:00-09:00 MSK), skip time checks for hourly tasks
    hour_utc = datetime.utcnow().hour
    if hour_utc >= 21 or hour_utc < 3:
        return {"ok": True, "age_min": round(age_min), "note": "night"}

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


def restart_pm2():
    """Restart PM2 mphub process."""
    try:
        log("  Restarting PM2 mphub...")
        result = subprocess.run(
            ["sudo", "pm2", "restart", "mphub"],
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

    # 4. Check disk
    disk = check_disk()
    log(f"Disk: {disk['percent']}%")
    if not disk["ok"]:
        alerts.append(("WARNING", f"*Диск* — заполнен на {disk['percent']}%."))

    # 5. Send alerts
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
