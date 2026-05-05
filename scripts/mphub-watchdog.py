#!/usr/bin/env python3
"""
MpHub Watchdog — auto-repair crashed services & analyze errors.

Runs every 5 minutes via launchd (com.mphub.watchdog).
1. Reads status.json from health-collector
2. Auto-restarts crashed services (circuit breaker: 3 strikes → stop)
3. Calls Claude Code for persistent failures & error analysis
4. Sends Telegram notifications (INFO / WARNING / CRITICAL)

Usage: python3 scripts/mphub-watchdog.py
"""

import json
import os
import sys
import time
import subprocess
import fcntl
from pathlib import Path
from datetime import datetime, timezone, timedelta

# ─── Config ──────────────────────────────────────────────────

PROJECT_DIR = Path(__file__).parent.parent
DATA_DIR = PROJECT_DIR / "public" / "data" / "monitor"
STATUS_PATH = DATA_DIR / "status.json"
STATE_PATH = DATA_DIR / "repair-state.json"
LOG_PATH = DATA_DIR / "repair-log.json"
LOCK_PATH = Path("/tmp/mphub-watchdog.lock")
TELEGRAM_ENV_PATH = PROJECT_DIR / "data" / "telegram.env"


def load_env_file(path):
    try:
        if not path.exists():
            return
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'\"")
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception:
        pass

# Telegram
load_env_file(TELEGRAM_ENV_PATH)
TG_TOKEN = os.environ.get("MPHUB_WATCHDOG_TG_TOKEN", "")
TG_CHAT_ID = os.environ.get("MPHUB_WATCHDOG_CHAT_ID", "")

# Thresholds
ERROR_THRESHOLD = 10          # errorsLast24h > this triggers analysis
MAX_RESTARTS = 3              # circuit breaker opens after N failures
RESTART_WINDOW = 3600         # 1 hour window for counting restarts
CIRCUIT_COOLDOWN = 1800       # 30 min before half-open retry
AI_COOLDOWN = 21600           # 6 hours between AI calls per service
CLAUDE_TIMEOUT = 60           # seconds

# Skip these (have their own watchdog or are self)
SKIP_IDS = {"openclaw-gateway", "openclaw-backup", "openclaw-watchdog", "openclaw-log-rotate", "mphub-watchdog"}

WATCHDOG_LOG = PROJECT_DIR / "data" / "watchdog.log"

# ─── Logging ─────────────────────────────────────────────────

def log(msg):
    line = f"[{datetime.now().isoformat(timespec='seconds')}] {msg}"
    # НЕ используем print() — launchd перенаправляет stdout в тот же watchdog.log,
    # что приводит к дублированию каждой строки.
    try:
        WATCHDOG_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(WATCHDOG_LOG, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ─── Lock file ───────────────────────────────────────────────

def acquire_lock():
    try:
        fp = open(LOCK_PATH, "w")
        fcntl.flock(fp, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fp
    except (IOError, OSError):
        return None


# ─── State management ────────────────────────────────────────

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


def load_repair_log():
    if LOG_PATH.exists():
        try:
            return json.loads(LOG_PATH.read_text())
        except Exception:
            pass
    return []


def save_repair_log(entries):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOG_PATH.write_text(json.dumps(entries[-200:], indent=2, ensure_ascii=False))


def add_log_entry(entries, service_id, action, result, details, ai_response=None):
    entries.append({
        "time": datetime.now().isoformat(timespec="seconds"),
        "serviceId": service_id,
        "action": action,
        "result": result,
        "details": details,
        "aiResponse": ai_response,
    })


# ─── Service control ─────────────────────────────────────────

def get_uid():
    return subprocess.run(["id", "-u"], capture_output=True, text=True).stdout.strip()


def restart_service(label):
    """Restart via launchctl. Returns True if service is running after restart."""
    uid = get_uid()
    plist_path = Path.home() / "Library" / "LaunchAgents" / f"{label}.plist"
    log(f"  Restarting {label}...")

    # Try kickstart first (fastest, works if plist is loaded)
    result = subprocess.run(
        ["launchctl", "kickstart", "-k", f"gui/{uid}/{label}"],
        capture_output=True, text=True, timeout=10,
    )

    if result.returncode != 0 and plist_path.exists():
        # Plist not loaded — bootout (if partially loaded) then bootstrap
        log(f"  kickstart failed, trying bootstrap...")
        subprocess.run(
            ["launchctl", "bootout", f"gui/{uid}/{label}"],
            capture_output=True, timeout=10,
        )
        time.sleep(1)
        subprocess.run(
            ["launchctl", "bootstrap", f"gui/{uid}", str(plist_path)],
            capture_output=True, timeout=10,
        )

    if result.returncode != 0 and not plist_path.exists():
        # No plist file — try legacy start as last resort
        subprocess.run(["launchctl", "start", label], capture_output=True, timeout=10)

    # Verify (wait a bit, then check)
    time.sleep(5)
    check = subprocess.run(
        ["launchctl", "list", label],
        capture_output=True, text=True, timeout=10,
    )
    has_pid = '"PID"' in check.stdout and '"PID" = 0' not in check.stdout
    # For cron tasks (no KeepAlive), check if loaded at all (exit_code 0)
    is_loaded = check.returncode == 0
    ok = has_pid or is_loaded
    log(f"  Restart {'OK' if ok else 'FAILED'} for {label}")
    return ok


# ─── Claude Code diagnostics ─────────────────────────────────

def call_claude(svc, log_tail=""):
    """Call Claude Code CLI for diagnosis. Returns string response or None."""
    prompt = f"""Service "{svc['name']}" (ID: {svc['id']}, type: {svc.get('type','unknown')}) is failing.
Status: {svc.get('status')}
PID: {svc.get('pid', 'none')}
Label: {svc.get('plistLabel', 'unknown')}
Script: {svc.get('scriptPath', 'unknown')}
Errors last 24h: {svc.get('errorsLast24h', 0)}

Last errors:
{chr(10).join(e.get('message','') for e in svc.get('lastErrors', [])[:5])}

Recent log (last 50 lines):
{log_tail}

Diagnose the problem in 2-3 sentences. Classify severity as: critical / warning / noise.
If you can suggest a fix command, include it. Be concise."""

    try:
        claude_cmd = os.environ.get("CLAUDE", "claude")
        result = subprocess.run(
            [claude_cmd, "--print", "--dangerously-skip-permissions", prompt],
            capture_output=True, text=True, timeout=CLAUDE_TIMEOUT,
            cwd=str(PROJECT_DIR),
        )
        response = result.stdout.strip()
        if response:
            log(f"  Claude response: {response[:200]}...")
            return response
        if result.stderr:
            log(f"  Claude stderr: {result.stderr[:200]}")
        return None
    except subprocess.TimeoutExpired:
        log("  Claude timed out (60s)")
        return None
    except FileNotFoundError:
        log("  Claude CLI not found")
        return None
    except Exception as e:
        log(f"  Claude error: {e}")
        return None


def get_log_tail(svc, lines=50):
    """Read last N lines of service log."""
    log_path = svc.get("logPath")
    if not log_path or not os.path.exists(log_path):
        return ""
    try:
        result = subprocess.run(
            ["tail", f"-{lines}", log_path],
            capture_output=True, text=True, timeout=5,
        )
        return result.stdout
    except Exception:
        return ""


# ─── Telegram ────────────────────────────────────────────────

LEVEL_EMOJI = {"INFO": "✅", "WARNING": "⚠️", "CRITICAL": "🚨"}

def send_telegram(level, message):
    if not TG_TOKEN or not TG_CHAT_ID:
        log("  Telegram skipped: MPHUB_WATCHDOG_TG_TOKEN/MPHUB_WATCHDOG_CHAT_ID are not configured")
        return
    emoji = LEVEL_EMOJI.get(level, "ℹ️")
    text = f"{emoji} *MpHub Watchdog — {level}*\n\n{message}"
    try:
        import urllib.request
        data = json.dumps({
            "chat_id": TG_CHAT_ID,
            "text": text,
            "parse_mode": "Markdown",
        }).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
            data=data,
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=10)
        log(f"  Telegram [{level}] sent")
    except Exception as e:
        log(f"  Telegram error: {e}")


# ─── Handlers ────────────────────────────────────────────────

def now_ts():
    return datetime.now().isoformat(timespec="seconds")


def ts_age(ts_str):
    """Returns seconds since the given ISO timestamp."""
    if not ts_str:
        return 999999
    try:
        dt = datetime.fromisoformat(ts_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds()
    except Exception:
        return 999999


def handle_crashed_service(svc, state, repair_log):
    """Handle a service with status == 'error'."""
    sid = svc["id"]
    label = svc.get("plistLabel", "")
    if not label:
        log(f"  {svc['name']}: no plistLabel, skipping")
        return

    s = state.setdefault(sid, {
        "restart_count": 0,
        "last_restart": None,
        "last_stable": None,
        "circuit": "closed",
        "circuit_opened_at": None,
        "ai_last_called": None,
        "ai_diagnosis": None,
    })

    # Reset restart count if outside window
    if s["last_restart"] and ts_age(s["last_restart"]) > RESTART_WINDOW:
        s["restart_count"] = 0

    circuit = s["circuit"]

    # Circuit OPEN — check cooldown for half-open
    if circuit == "open":
        age = ts_age(s["circuit_opened_at"])
        if age < CIRCUIT_COOLDOWN:
            log(f"  {svc['name']}: circuit OPEN, waiting {int(CIRCUIT_COOLDOWN - age)}s")
            return
        log(f"  {svc['name']}: circuit → half-open, trying one restart")
        s["circuit"] = "half-open"
        circuit = "half-open"

    # Try restart
    ok = restart_service(label)
    s["last_restart"] = now_ts()
    s["restart_count"] += 1

    if ok:
        s["circuit"] = "closed"
        s["restart_count"] = 0
        s["last_stable"] = now_ts()
        add_log_entry(repair_log, sid, "restart", "success", f"Auto-restarted {svc['name']}")
        send_telegram("INFO", f"*{svc['name']}* — перезапущен и работает.")
        log(f"  {svc['name']}: recovered!")
        return

    # Restart failed
    add_log_entry(repair_log, sid, "restart", "failed", f"Restart failed for {svc['name']}")

    if s["restart_count"] >= MAX_RESTARTS:
        # Open circuit breaker
        s["circuit"] = "open"
        s["circuit_opened_at"] = now_ts()
        send_telegram("CRITICAL", f"*{svc['name']}* — упал {s['restart_count']}x за час.\nCircuit breaker OPEN. Требуется ручное вмешательство.")
        log(f"  {svc['name']}: circuit breaker OPEN after {s['restart_count']} failures")
        return

    if s["restart_count"] >= 2:
        # Call Claude for diagnosis
        if ts_age(s.get("ai_last_called")) > 1800:  # not more than every 30 min
            log(f"  {svc['name']}: calling Claude for diagnosis...")
            log_tail = get_log_tail(svc, 50)
            diagnosis = call_claude(svc, log_tail)
            s["ai_last_called"] = now_ts()
            s["ai_diagnosis"] = diagnosis
            add_log_entry(repair_log, sid, "ai_diagnosis", "done", f"Claude diagnosis for {svc['name']}", diagnosis)
            if diagnosis:
                send_telegram("WARNING", f"*{svc['name']}* — повторное падение.\n\nДиагноз Claude:\n_{diagnosis[:500]}_")


def handle_error_analysis(svc, state, repair_log):
    """Analyze errors for running services with high error count."""
    if svc.get("status") != "running":
        return
    if (svc.get("errorsLast24h") or 0) <= ERROR_THRESHOLD:
        return

    sid = svc["id"]
    s = state.setdefault(sid, {
        "restart_count": 0, "last_restart": None, "last_stable": None,
        "circuit": "closed", "circuit_opened_at": None,
        "ai_last_called": None, "ai_diagnosis": None,
    })

    # Rate limit: once per 6 hours
    if ts_age(s.get("ai_last_called")) < AI_COOLDOWN:
        return

    log(f"  {svc['name']}: {svc['errorsLast24h']} errors, analyzing...")
    log_tail = get_log_tail(svc, 200)
    diagnosis = call_claude(svc, log_tail)
    s["ai_last_called"] = now_ts()
    s["ai_diagnosis"] = diagnosis
    add_log_entry(repair_log, sid, "error_analysis", "done",
                  f"{svc['errorsLast24h']} errors in 24h for {svc['name']}", diagnosis)

    if diagnosis:
        send_telegram("WARNING",
                      f"*{svc['name']}* — {svc['errorsLast24h']} ошибок за 24ч.\n\nАнализ Claude:\n_{diagnosis[:500]}_")


def handle_stable_service(svc, state):
    """Mark running service as stable, reset counters."""
    sid = svc["id"]
    if sid not in state:
        return
    s = state[sid]
    if s.get("circuit") != "closed" or s.get("restart_count", 0) > 0:
        log(f"  {svc['name']}: now stable, resetting counters")
    s["circuit"] = "closed"
    s["restart_count"] = 0
    s["last_stable"] = now_ts()


# ─── Main ────────────────────────────────────────────────────

def main():
    log("=== MpHub Watchdog started ===")

    # Load status
    if not STATUS_PATH.exists():
        log("No status.json found, exiting")
        return

    try:
        status = json.loads(STATUS_PATH.read_text())
    except Exception as e:
        log(f"Failed to read status.json: {e}")
        return

    services = status.get("services", [])
    active = [s for s in services if s.get("lifecycle") != "archived" and s["id"] not in SKIP_IDS]

    state = load_state()
    repair_log = load_repair_log()

    crashed = [s for s in active if s.get("status") == "error"]
    running = [s for s in active if s.get("status") == "running"]

    log(f"Active: {len(active)} | Running: {len(running)} | Crashed: {len(crashed)}")

    # 1. Handle crashed services
    for svc in crashed:
        log(f"CRASHED: {svc['name']} (id={svc['id']})")
        handle_crashed_service(svc, state, repair_log)

    # 2. Mark running services as stable
    for svc in running:
        handle_stable_service(svc, state)

    # 3. Analyze errors for running services
    for svc in running:
        handle_error_analysis(svc, state, repair_log)

    # Save
    save_state(state)
    save_repair_log(repair_log)

    log("=== Watchdog done ===\n")


if __name__ == "__main__":
    lock = acquire_lock()
    if not lock:
        print("Another watchdog instance is running, exiting")
        sys.exit(0)
    try:
        main()
    finally:
        lock.close()
        try:
            LOCK_PATH.unlink()
        except Exception:
            pass
