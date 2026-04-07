#!/usr/bin/env python3
"""health-collector.py — Collect status of all registered launchd services.
Output: public/data/monitor/status.json
"""

import json
import subprocess
import os
import re
import hashlib
from datetime import datetime, timezone, timedelta
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
REGISTRY_PATH = PROJECT_DIR / "public" / "data" / "monitor" / "monitor-registry.json"
OUTPUT_PATH = PROJECT_DIR / "public" / "data" / "monitor" / "status.json"
LAUNCH_AGENTS_DIR = Path.home() / "Library" / "LaunchAgents"

TZ_MSK = timezone(timedelta(hours=3))
NOW = datetime.now(TZ_MSK)
NOW_EPOCH = int(NOW.timestamp())


def format_uptime(secs: int) -> str:
    if secs <= 0:
        return "0m"
    d = secs // 86400
    h = (secs % 86400) // 3600
    m = (secs % 3600) // 60
    parts = []
    if d > 0:
        parts.append(f"{d}d")
    if h > 0:
        parts.append(f"{h}h")
    if m > 0:
        parts.append(f"{m}m")
    return " ".join(parts) or "0m"


def run_cmd(cmd: str, timeout: int = 5) -> str:
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return ""


def get_launchctl_info(label: str) -> dict:
    """Get PID, exit code, status from launchctl."""
    raw = run_cmd(f"launchctl list {label} 2>/dev/null")
    if not raw:
        return {"found": False}

    pid = None
    exit_code = None
    for line in raw.splitlines():
        line = line.strip()
        if '"PID"' in line:
            m = re.search(r'(\d+)', line.split("=")[-1])
            if m:
                pid = int(m.group(1))
        if '"LastExitStatus"' in line:
            m = re.search(r'(\d+)', line.split("=")[-1])
            if m:
                exit_code = int(m.group(1))

    return {"found": True, "pid": pid, "exit_code": exit_code}


def get_process_uptime(pid: int) -> int:
    """Get process uptime in seconds."""
    if not pid:
        return 0
    lstart = run_cmd(f"ps -p {pid} -o lstart= 2>/dev/null")
    if not lstart:
        return 0
    try:
        # macOS format: "Wed Mar 26 02:30:15 2026"
        start = datetime.strptime(lstart.strip(), "%a %b %d %H:%M:%S %Y")
        start = start.replace(tzinfo=TZ_MSK)
        return max(0, int((NOW - start).total_seconds()))
    except Exception:
        return 0


def get_schedule_from_plist(label: str, internal_schedule: dict | None = None) -> dict:
    """Parse schedule from plist or use internal schedule."""
    if internal_schedule:
        return internal_schedule

    plist_path = LAUNCH_AGENTS_DIR / f"{label}.plist"
    if not plist_path.exists():
        return {"type": "unknown", "description": "plist не найден"}

    def plist_read(key: str) -> str:
        return run_cmd(f'/usr/libexec/PlistBuddy -c "Print :{key}" "{plist_path}" 2>/dev/null')

    # KeepAlive
    ka = plist_read("KeepAlive")
    if ka.lower() == "true":
        return {"type": "keepalive", "description": "постоянно"}

    # StartInterval
    si = plist_read("StartInterval")
    if si and si.isdigit() and int(si) > 0:
        sec = int(si)
        mins = sec // 60
        if mins >= 60:
            return {"type": "interval", "intervalMin": mins, "description": f"каждые {mins // 60} ч"}
        elif mins > 0:
            return {"type": "interval", "intervalMin": mins, "description": f"каждые {mins} мин"}
        else:
            return {"type": "interval", "intervalSec": sec, "description": f"каждые {sec} сек"}

    # StartCalendarInterval — check if it's an array (multiple schedules)
    # Try reading first array element
    first_hour = plist_read("StartCalendarInterval:0:Hour")
    if first_hour and first_hour.isdigit():
        # It's an array — find hour range
        hours = []
        for idx in range(24):
            h = plist_read(f"StartCalendarInterval:{idx}:Hour")
            if not h or not h.isdigit():
                break
            hours.append(int(h))
        if hours:
            minute = plist_read("StartCalendarInterval:0:Minute") or "0"
            minute = int(minute) if minute.isdigit() else 0
            return {
                "type": "calendar_range",
                "hours": hours,
                "minute": minute,
                "description": f"каждый час {hours[0]:02d}:00–{hours[-1]:02d}:00",
                "runsPerDay": len(hours),
            }

    # Single calendar interval
    hour = plist_read("StartCalendarInterval:Hour")
    if hour and hour.isdigit():
        minute = plist_read("StartCalendarInterval:Minute") or "0"
        minute = int(minute) if minute.isdigit() else 0
        return {
            "type": "calendar",
            "hour": int(hour),
            "minute": minute,
            "description": f"ежедневно в {int(hour):02d}:{minute:02d}",
        }

    # RunAtLoad only
    ral = plist_read("RunAtLoad")
    if ral.lower() == "true":
        return {"type": "runAtLoad", "description": "при загрузке"}

    return {"type": "unknown", "description": "расписание не определено"}


def calc_next_run(schedule: dict) -> str | None:
    stype = schedule.get("type", "")
    if stype == "interval":
        imin = schedule.get("intervalMin", 0)
        if imin > 0:
            now_min = NOW_EPOCH // 60
            next_min = ((now_min // imin) + 1) * imin
            return datetime.fromtimestamp(next_min * 60, TZ_MSK).isoformat()
    elif stype == "calendar":
        hour = schedule.get("hour", 0)
        minute = schedule.get("minute", 0)
        target = NOW.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target <= NOW:
            target += timedelta(days=1)
        return target.isoformat()
    elif stype == "calendar_range":
        hours = schedule.get("hours", [])
        minute = schedule.get("minute", 0)
        for h in hours:
            target = NOW.replace(hour=h, minute=minute, second=0, microsecond=0)
            if target > NOW:
                return target.isoformat()
        # All hours passed today — first one tomorrow
        if hours:
            target = NOW.replace(hour=hours[0], minute=minute, second=0, microsecond=0) + timedelta(days=1)
            return target.isoformat()
    return None


def calc_runs_today(schedule: dict) -> tuple[int, int]:
    """Return (runsCompleted, runsTotal) for today."""
    stype = schedule.get("type", "")
    if stype == "calendar_range":
        total = schedule.get("runsPerDay", 0)
        hours = schedule.get("hours", [])
        completed = sum(1 for h in hours if h <= NOW.hour)
        return completed, total
    elif stype == "interval":
        imin = schedule.get("intervalMin", 0)
        if imin > 0:
            # From midnight to now
            mins_today = NOW.hour * 60 + NOW.minute
            completed = mins_today // imin
            total = 1440 // imin  # runs per day
            return completed, total
    return -1, -1


def count_errors_in_log(log_path: str | None) -> tuple[int, list[dict]]:
    """Count errors in last 100 lines and return last 5 errors."""
    if not log_path or log_path == "null" or not os.path.isfile(log_path):
        return 0, []

    try:
        lines = run_cmd(f'tail -n 200 "{log_path}" 2>/dev/null').splitlines()
    except Exception:
        return 0, []

    errors = []
    for line in lines:
        if re.search(r"ERROR|CRITICAL|Exception|Traceback", line, re.IGNORECASE):
            # Skip false positives like "errors=0", "errors: 0", "0 errors"
            if re.search(r"errors?\s*[=:]\s*0\b|0\s+errors?\b", line, re.IGNORECASE):
                continue
            time_match = re.search(r"(\d{2}:\d{2})", line)
            time_str = time_match.group(1) if time_match else ""
            errors.append({"time": time_str, "message": line[:200].strip()})

    return len(errors), errors[-5:]


def get_file_hash(path: str | None) -> str:
    if not path or not os.path.isfile(path):
        return ""
    try:
        h = hashlib.sha256(open(path, "rb").read()).hexdigest()[:8]
        return h
    except Exception:
        return ""


def get_last_modified(path: str | None) -> str:
    if not path or not os.path.isfile(path):
        return ""
    try:
        mtime = os.path.getmtime(path)
        return datetime.fromtimestamp(mtime, TZ_MSK).isoformat()
    except Exception:
        return ""


def get_last_run_from_log(log_path: str | None) -> str | None:
    """Get last successful run timestamp from log."""
    if not log_path or not os.path.isfile(log_path):
        return None
    last_line = run_cmd(f'tail -n 1 "{log_path}" 2>/dev/null')
    if not last_line:
        return None
    # Try common timestamp formats
    m = re.match(r"(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})", last_line)
    if m:
        try:
            ts = m.group(1).replace("T", " ")
            dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
            return dt.replace(tzinfo=TZ_MSK).isoformat()
        except Exception:
            pass
    # ISO format in brackets
    m = re.match(r"\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", last_line)
    if m:
        try:
            return m.group(1) + "+03:00"
        except Exception:
            pass
    return None


def main():
    with open(REGISTRY_PATH) as f:
        registry = json.load(f)

    services = []

    for svc in registry:
        svc_id = svc.get("id", "")
        label = svc.get("plistLabel", "")
        log_path = svc.get("logPath")
        script_path = svc.get("scriptPath")
        lifecycle = svc.get("lifecycle", "active")
        internal_schedule = svc.get("internalSchedule")

        # Archived/deleted — minimal info
        if lifecycle in ("archived", "deleted"):
            services.append({
                "id": svc_id,
                "name": svc.get("name", ""),
                "description": svc.get("description", ""),
                "project": svc.get("project", ""),
                "type": svc.get("type", ""),
                "scriptPath": script_path,
                "plistLabel": label,
                "logPath": log_path,
                "status": lifecycle,
                "pid": None,
                "uptime": "",
                "uptimeSeconds": 0,
                "lastRun": None,
                "nextRun": None,
                "schedule": {"type": "none", "description": "—"},
                "runsToday": 0,
                "runsTotal": -1,
                "errorsLast24h": 0,
                "lastErrors": [],
                "fileHash": "",
                "lastModified": None,
                "lifecycle": lifecycle,
            })
            continue

        # Get launchd info
        lctl = get_launchctl_info(label)
        pid = lctl.get("pid") if lctl.get("found") else None
        exit_code = lctl.get("exit_code")

        if pid and pid > 0:
            status = "running"
            uptime_secs = get_process_uptime(pid)
        elif lctl.get("found") and exit_code and exit_code != 0:
            status = "error"
            uptime_secs = 0
        elif lctl.get("found"):
            status = "stopped"
            uptime_secs = 0
        else:
            status = "unknown"
            uptime_secs = 0

        # Fallback: check if port 3000 is open (for MpHub Website running via npm run dev)
        if status in ("unknown", "error") and svc_id == "mphub-website":
            try:
                import socket
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(1)
                    if s.connect_ex(("127.0.0.1", 3000)) == 0:
                        status = "running"
                        uptime_secs = 0
            except Exception:
                pass

        uptime = format_uptime(uptime_secs)
        schedule = get_schedule_from_plist(label, internal_schedule)
        next_run = calc_next_run(schedule)
        runs_today, runs_total = calc_runs_today(schedule)
        error_count, last_errors = count_errors_in_log(log_path)
        file_hash = get_file_hash(script_path)
        last_modified = get_last_modified(script_path)
        last_run = get_last_run_from_log(log_path)

        services.append({
            "id": svc_id,
            "name": svc.get("name", ""),
            "description": svc.get("description", ""),
            "project": svc.get("project", ""),
            "type": svc.get("type", ""),
            "scriptPath": script_path,
            "plistLabel": label,
            "logPath": log_path,
            "status": status,
            "pid": pid if pid and pid > 0 else None,
            "uptime": uptime,
            "uptimeSeconds": uptime_secs,
            "lastRun": last_run,
            "nextRun": next_run,
            "schedule": schedule,
            "runsToday": runs_today,
            "runsTotal": runs_total,
            "errorsLast24h": error_count,
            "lastErrors": last_errors,
            "fileHash": file_hash,
            "lastModified": last_modified,
            "lifecycle": lifecycle,
        })

    result = {
        "timestamp": NOW.isoformat(),
        "machine": "MacBook Air",
        "services": services,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
