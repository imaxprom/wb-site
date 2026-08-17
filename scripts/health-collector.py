#!/usr/bin/env python3
"""health-collector.py — собирает статусы сервисов MpHub (VPS, Linux).
Источники: PM2 (pm2 jlist) для веб-сервиса, cron + mtime логов для плановых задач.
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
ORGANIZATION_ID = int(os.environ.get("MPHUB_ORGANIZATION_ID", "1"))
if ORGANIZATION_ID <= 0:
    raise RuntimeError("MPHUB_ORGANIZATION_ID must be a positive integer")
ORGANIZATION_DATA_DIR = PROJECT_DIR / "data" / "organizations" / str(ORGANIZATION_ID)
OUTPUT_PATH = ORGANIZATION_DATA_DIR / "monitor-status.json"
LEGACY_OUTPUT_PATH = PROJECT_DIR / "public" / "data" / "monitor" / "status.json"

TZ_MSK = timezone(timedelta(hours=3))
NOW = datetime.now(TZ_MSK)
NOW_EPOCH = int(NOW.timestamp())

WEEKDAY_RU = {1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 0: "Вс", 7: "Вс"}


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


# ── PM2 ──────────────────────────────────────────────────────
_PM2_CACHE: list | None = None


def get_pm2_list() -> list:
    global _PM2_CACHE
    if _PM2_CACHE is not None:
        return _PM2_CACHE
    raw = run_cmd("pm2 jlist 2>/dev/null") or run_cmd("sudo pm2 jlist 2>/dev/null")
    try:
        _PM2_CACHE = json.loads(raw) if raw else []
    except Exception:
        _PM2_CACHE = []
    return _PM2_CACHE


def get_pm2_info(name: str) -> dict:
    for p in get_pm2_list():
        if p.get("name") == name:
            env = p.get("pm2_env", {}) or {}
            return {
                "found": True,
                "status": env.get("status", "unknown"),
                "pid": p.get("pid") or None,
                "uptime_ms": env.get("pm_uptime"),
                "restarts": env.get("restart_time", 0),
            }
    return {"found": False}


# ── Cron parsing ─────────────────────────────────────────────

def _utc_to_msk_hours(hours_utc: list[int]) -> list[int]:
    return sorted({(h + 3) % 24 for h in hours_utc})


def parse_cron_pattern(pattern: str) -> dict:
    """Преобразует крон-паттерн в описание расписания для UI."""
    parts = pattern.split()
    if len(parts) != 5:
        return {"type": "cron", "description": pattern}

    minute_p, hour_p, day_p, month_p, weekday_p = parts

    def weekday_label(value: str) -> str:
        wd_range = re.fullmatch(r"(\d+)-(\d+)", value)
        if wd_range:
            a, b = int(wd_range.group(1)), int(wd_range.group(2))
            return f"{WEEKDAY_RU.get(a,'?')}-{WEEKDAY_RU.get(b,'?')}"
        if value.isdigit():
            return WEEKDAY_RU.get(int(value), value)
        return value

    # Интервал: */N * * * *
    if minute_p.startswith("*/") and hour_p == "*" and day_p == "*" and weekday_p == "*":
        try:
            imin = int(minute_p[2:])
            return {"type": "interval", "intervalMin": imin, "description": f"каждые {imin} мин"}
        except ValueError:
            pass

    # Ежечасно: 0 * * * *
    if minute_p.isdigit() and hour_p == "*" and day_p == "*" and month_p == "*" and weekday_p == "*":
        minute = int(minute_p)
        desc = "каждый час" if minute == 0 else f"каждый час в :{minute:02d}"
        return {"type": "interval", "intervalMin": 60, "minute": minute, "description": desc}

    # Один запуск в конкретное время: 0 1 * * * или 0 19 * * 1-5.
    if minute_p.isdigit() and hour_p.isdigit() and day_p == "*" and month_p == "*":
        hour_msk = (int(hour_p) + 3) % 24
        minute = int(minute_p)
        time_str = f"{hour_msk:02d}:{minute:02d}"
        if weekday_p == "*":
            desc = f"ежедневно в {time_str} МСК"
        else:
            desc = f"{weekday_label(weekday_p)}, в {time_str} МСК"
        return {
            "type": "calendar_range",
            "hours": [hour_msk],
            "minute": minute,
            "description": desc,
            "runsPerDay": 1,
            **({} if weekday_p == "*" else {"days": weekday_label(weekday_p)}),
        }

    # Диапазон часов: 0 3-20 * * * (возможно с weekday)
    hour_range = re.fullmatch(r"(\d+)-(\d+)", hour_p)
    if minute_p.isdigit() and hour_range:
        start_utc = int(hour_range.group(1))
        end_utc = int(hour_range.group(2))
        hours_utc = list(range(start_utc, end_utc + 1))
        hours_msk = _utc_to_msk_hours(hours_utc)
        days_str = ""
        if weekday_p != "*":
            days_str = weekday_label(weekday_p)
        desc = f"{hours_msk[0]:02d}:00–{hours_msk[-1]:02d}:00 МСК"
        if days_str:
            desc = f"{days_str}, {desc}"
        result = {
            "type": "calendar_range",
            "hours": hours_msk,
            "minute": int(minute_p),
            "description": desc,
            "runsPerDay": len(hours_msk),
        }
        if days_str:
            result["days"] = days_str
        return result

    # Перечень часов: 0 6,9,12,15,18 * * *
    if minute_p.isdigit() and "," in hour_p and day_p == "*" and weekday_p == "*":
        try:
            hours_utc = [int(h) for h in hour_p.split(",")]
            hours_msk = _utc_to_msk_hours(hours_utc)
            hours_str = ", ".join(f"{h:02d}:{int(minute_p):02d}" for h in hours_msk)
            return {
                "type": "calendar_range",
                "hours": hours_msk,
                "minute": int(minute_p),
                "description": f"в {hours_str} МСК",
                "runsPerDay": len(hours_msk),
            }
        except ValueError:
            pass

    return {"type": "cron", "description": pattern}


def calc_next_run(schedule: dict) -> str | None:
    stype = schedule.get("type", "")
    if stype == "interval":
        imin = schedule.get("intervalMin", 0)
        if imin > 0:
            if imin == 60 and "minute" in schedule:
                target = NOW.replace(minute=int(schedule["minute"]), second=0, microsecond=0)
                if target <= NOW:
                    target += timedelta(hours=1)
                return target.isoformat()
            now_min = NOW_EPOCH // 60
            next_min = ((now_min // imin) + 1) * imin
            return datetime.fromtimestamp(next_min * 60, TZ_MSK).isoformat()
    elif stype == "calendar_range":
        hours = schedule.get("hours", [])
        minute = schedule.get("minute", 0)
        for h in hours:
            target = NOW.replace(hour=h, minute=minute, second=0, microsecond=0)
            if target > NOW:
                return target.isoformat()
        if hours:
            target = NOW.replace(hour=hours[0], minute=minute, second=0, microsecond=0) + timedelta(days=1)
            return target.isoformat()
    return None


def calc_runs_today(schedule: dict) -> tuple[int, int]:
    stype = schedule.get("type", "")
    if stype == "calendar_range":
        total = schedule.get("runsPerDay", 0)
        hours = schedule.get("hours", [])
        completed = sum(1 for h in hours if h <= NOW.hour)
        return completed, total
    if stype == "interval":
        imin = schedule.get("intervalMin", 0)
        if imin > 0:
            mins_today = NOW.hour * 60 + NOW.minute
            completed = mins_today // imin
            total = 1440 // imin
            return completed, total
    return -1, -1


# ── Log helpers ──────────────────────────────────────────────

def parse_log_timestamp(line: str, fallback: datetime | None = None) -> datetime | None:
    match = re.search(r"\[(\d{4}-\d{2}-\d{2}[T ][^\]]+)\]", line)
    if not match:
        return fallback
    raw = match.group(1).strip().replace(" ", "T", 1)
    try:
        if raw.endswith("Z"):
            return datetime.fromisoformat(raw[:-1] + "+00:00").astimezone(TZ_MSK)
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(TZ_MSK)
    except Exception:
        return fallback


def sanitize_log_line(line: str) -> str:
    value = re.sub(r"https://api\.telegram\.org/bot[^/\s]+", "https://api.telegram.org/bot[redacted]", line, flags=re.I)
    value = re.sub(r"\bBearer\s+[^\s,}\]]+", "Bearer [redacted]", value, flags=re.I)
    value = re.sub(
        r"((?:token|cookie|authorization|api[_ -]?key|secret)\s*[=:]\s*[\"']?)[^\s,\"'}\]]+",
        r"\1[redacted]",
        value,
        flags=re.I,
    )
    return value


def count_errors_in_log(log_path: str | None) -> tuple[int, list[dict]]:
    if not log_path or log_path == "null" or not os.path.isfile(log_path):
        return 0, []
    try:
        with open(log_path, "r", errors="replace") as handle:
            lines = handle.readlines()[-5000:]
    except Exception:
        return 0, []
    cutoff = NOW - timedelta(hours=24)
    errors = []
    current_timestamp = None
    for line in lines:
        current_timestamp = parse_log_timestamp(line, current_timestamp)
        if re.search(r"\b(?:FATAL|ERROR|CRITICAL)\b|Exception|Traceback|\"errors\"\s*:\s*\[(?!\])", line, re.IGNORECASE):
            if re.search(r"errors?\s*[=:]\s*0\b|0\s+errors?\b", line, re.IGNORECASE):
                continue
            if current_timestamp is None or current_timestamp < cutoff:
                continue
            time_str = current_timestamp.astimezone(TZ_MSK).strftime("%d.%m %H:%M")
            errors.append({"time": time_str, "message": sanitize_log_line(line[:500].strip())[:200]})
    return len(errors), errors[-5:]


def get_file_hash(path: str | None) -> str:
    if not path or not os.path.isfile(path):
        return ""
    try:
        return hashlib.sha256(open(path, "rb").read()).hexdigest()[:8]
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


def get_log_mtime(log_path: str | None) -> datetime | None:
    if not log_path or not os.path.isfile(log_path):
        return None
    try:
        return datetime.fromtimestamp(os.path.getmtime(log_path), TZ_MSK)
    except Exception:
        return None


def get_last_run_from_log(log_path: str | None) -> str | None:
    if not log_path or not os.path.isfile(log_path):
        return None
    raw = run_cmd(f'grep -v "^$" "{log_path}" 2>/dev/null | tail -n 20')
    if not raw:
        # Фолбэк: mtime лога, если в нём нет парсимых таймстемпов
        mtime = get_log_mtime(log_path)
        return mtime.isoformat() if mtime else None
    for line in reversed(raw.split("\n")):
        line = line.strip()
        if not line:
            continue
        m = re.match(r"\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.\d+Z\]", line)
        if m:
            # UTC → МСК
            try:
                dt = datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
                return dt.astimezone(TZ_MSK).isoformat()
            except Exception:
                pass
        m = re.match(r"\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})\]?", line)
        if m:
            return m.group(1).replace("T", " ") + "+03:00"
        m = re.match(r"(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})", line)
        if m:
            return m.group(1).replace("T", " ") + "+03:00"
    mtime = get_log_mtime(log_path)
    return mtime.isoformat() if mtime else None


# ── Status inference ─────────────────────────────────────────

def max_gap_for_schedule(schedule: dict) -> int:
    """Верхняя граница «допустимого» промежутка между запусками, в минутах."""
    stype = schedule.get("type", "")
    if stype == "interval":
        imin = schedule.get("intervalMin", 60)
        return max(imin * 3, 10)  # 3× интервал, но не меньше 10 мин
    if stype == "calendar_range":
        if schedule.get("days"):
            return 96 * 60  # Пн-Ср → окно 4 суток
        return 25 * 60
    return 48 * 60


def status_from_log(log_path: str | None, schedule: dict) -> str:
    mtime = get_log_mtime(log_path)
    if mtime is None:
        return "stopped"
    age_min = (NOW - mtime).total_seconds() / 60
    return "idle" if age_min < max_gap_for_schedule(schedule) else "stopped"


def data_health_status(log_path: str | None) -> tuple[str | None, int | None, list[dict] | None, str | None]:
    """Promote data-health JSON checks into the service status card."""
    if not log_path or not os.path.isfile(log_path):
        return None, None, None, None
    try:
        data = json.loads(Path(log_path).read_text())
    except Exception:
        return "error", 1, [{"time": "", "message": "data-health-cron.json не читается"}], None

    overall = data.get("overall")
    checks = data.get("checks") if isinstance(data.get("checks"), list) else []
    bad = [c for c in checks if c.get("status") in ("error", "warn")]
    errors = [c for c in checks if c.get("status") == "error"]
    last_errors = []
    for c in bad[:5]:
        message = f"{c.get('name', c.get('id', 'check'))}: {c.get('value', '')}"
        if c.get("detail"):
            message = f"{message} — {c.get('detail')}"
        last_errors.append({"time": "", "message": message[:200]})

    if overall == "error":
        return "error", max(1, len(errors)), last_errors, data.get("timestamp")
    if overall == "warn":
        return "idle", 0, last_errors, data.get("timestamp")
    if overall == "ok":
        return "idle", 0, [], data.get("timestamp")
    return None, None, None, data.get("timestamp")


_DISABLED_SERVICE_IDS: set[str] | None = None
_HEALTH_SERVICE_STATUSES: dict[str, str] | None = None


def get_disabled_service_ids() -> set[str]:
    global _DISABLED_SERVICE_IDS
    if _DISABLED_SERVICE_IDS is not None:
        return _DISABLED_SERVICE_IDS

    mapping = {
        "cron_paid_storage": "paid-storage-sync",
        "cron_warehouse_remains": "warehouse-remains-sync",
        "cron_warehouse_measurements": "warehouse-measurements-sync",
        "cron_reviews_sync": "reviews-sync",
        "cron_reviews_complaints": "reviews-complaints",
    }
    disabled: set[str] = set()
    snapshot_path = ORGANIZATION_DATA_DIR / "data-health-cron.json"
    try:
        payload = json.loads(snapshot_path.read_text())
        for check in payload.get("checks", []):
            if check.get("status") == "disabled" and check.get("id") in mapping:
                disabled.add(mapping[check["id"]])
    except Exception:
        pass
    _DISABLED_SERVICE_IDS = disabled
    return disabled


def get_health_service_statuses() -> dict[str, str]:
    global _HEALTH_SERVICE_STATUSES
    if _HEALTH_SERVICE_STATUSES is not None:
        return _HEALTH_SERVICE_STATUSES
    mapping = {
        "cron_daily_sync": "daily-sync",
        "cron_weekly_sync": "weekly-sync",
        "cron_shipment_sync": "shipment-sync",
        "cron_supply_reports_sync": "supply-reports-sync",
        "cron_reviews_sync": "reviews-sync",
        "cron_reviews_complaints": "reviews-complaints",
        "cron_paid_storage": "paid-storage-sync",
        "cron_auth_check": "auth-check",
        "cron_warehouse_remains": "warehouse-remains-sync",
        "cron_warehouse_measurements": "warehouse-measurements-sync",
    }
    statuses: dict[str, str] = {}
    snapshot_path = ORGANIZATION_DATA_DIR / "data-health-cron.json"
    try:
        payload = json.loads(snapshot_path.read_text())
        for check in payload.get("checks", []):
            service_id = mapping.get(check.get("id"))
            if service_id:
                statuses[service_id] = str(check.get("status", ""))
    except Exception:
        pass
    _HEALTH_SERVICE_STATUSES = statuses
    return statuses


# ── Main ─────────────────────────────────────────────────────

def build_service(svc: dict) -> dict:
    svc_id = svc.get("id", "")
    log_path = svc.get("logPath")
    if log_path and svc_id not in ("mphub-website", "mphub-watchdog"):
        log_path = str(ORGANIZATION_DATA_DIR / Path(log_path).name)
    script_path = svc.get("scriptPath")
    lifecycle = svc.get("lifecycle", "active")
    cron_pattern = svc.get("cronPattern")
    pm2_name = svc.get("pm2Name")

    base = {
        "id": svc_id,
        "name": svc.get("name", ""),
        "nameRu": svc.get("nameRu", ""),
        "description": svc.get("description", ""),
        "project": svc.get("project", ""),
        "type": svc.get("type", ""),
        "scriptPath": script_path,
        "plistLabel": pm2_name or cron_pattern or "",
        "logPath": log_path,
        "lifecycle": lifecycle,
    }

    disabled_service_ids = get_disabled_service_ids()
    if svc_id in disabled_service_ids:
        base.update({
            "status": "disabled", "pid": None, "uptime": "", "uptimeSeconds": 0,
            "lastRun": None, "nextRun": None,
            "schedule": {"type": "none", "description": "не используется этим юрлицом"},
            "runsToday": 0, "runsTotal": -1,
            "errorsLast24h": 0, "lastErrors": [],
            "fileHash": get_file_hash(script_path), "lastModified": get_last_modified(script_path),
        })
        return base

    if lifecycle in ("archived", "deleted"):
        base.update({
            "status": lifecycle, "pid": None, "uptime": "", "uptimeSeconds": 0,
            "lastRun": None, "nextRun": None,
            "schedule": {"type": "none", "description": "—"},
            "runsToday": 0, "runsTotal": -1,
            "errorsLast24h": 0, "lastErrors": [],
            "fileHash": "", "lastModified": None,
        })
        return base

    # Расписание
    if pm2_name:
        schedule = {"type": "keepalive", "description": "постоянно (PM2)"}
    elif cron_pattern:
        schedule = parse_cron_pattern(cron_pattern)
    else:
        schedule = {"type": "unknown", "description": "—"}

    # Статус
    status = "unknown"
    pid = None
    uptime_secs = 0

    if pm2_name:
        info = get_pm2_info(pm2_name)
        if info.get("found"):
            if info.get("status") == "online":
                status = "running"
                if info.get("uptime_ms"):
                    uptime_secs = max(0, int((NOW_EPOCH * 1000 - int(info["uptime_ms"])) / 1000))
            elif info.get("status") in ("stopped", "stopping"):
                status = "stopped"
            else:
                status = "error"
            pid = info.get("pid")
        else:
            status = "stopped"
    elif cron_pattern:
        status = status_from_log(log_path, schedule)

    health_status = get_health_service_statuses().get(svc_id)
    if health_status == "error":
        status = "error"

    next_run = calc_next_run(schedule)
    runs_today, runs_total = calc_runs_today(schedule)
    error_count, last_errors = count_errors_in_log(log_path)
    file_hash = get_file_hash(script_path)
    last_modified = get_last_modified(script_path)
    last_run = get_last_run_from_log(log_path)

    if svc_id == "data-health-cron":
        dh_status, dh_error_count, dh_errors, dh_timestamp = data_health_status(log_path)
        if dh_status:
            status = dh_status
        if dh_error_count is not None:
            error_count = dh_error_count
        if dh_errors is not None:
            last_errors = dh_errors
        if dh_timestamp:
            last_run = dh_timestamp

    base.update({
        "status": status,
        "pid": pid if pid and pid > 0 else None,
        "uptime": format_uptime(uptime_secs),
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
    })
    return base


def main():
    with open(REGISTRY_PATH) as f:
        registry = json.load(f)

    services = [build_service(svc) for svc in registry]
    result = {
        "timestamp": NOW.isoformat(),
        "machine": "VPS wb-site",
        "organizationId": ORGANIZATION_ID,
        "services": services,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    if ORGANIZATION_ID == 1:
        LEGACY_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(LEGACY_OUTPUT_PATH, "w") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
