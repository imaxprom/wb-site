#!/usr/bin/env bash
# script-scanner.sh — Scans for new scripts/services and tracks file changes
# Updates monitor-registry.json and changes.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REGISTRY="$PROJECT_DIR/public/data/monitor/monitor-registry.json"
CHANGES="$PROJECT_DIR/public/data/monitor/changes.json"

NOW_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
NOW_EPOCH=$(date +%s)
SEVEN_DAYS_AGO=$((NOW_EPOCH - 604800))

if [ ! -f "$REGISTRY" ]; then
  echo "Registry not found: $REGISTRY" >&2
  exit 1
fi

if [ ! -f "$CHANGES" ]; then
  echo "[]" > "$CHANGES"
fi

# ─── 1. Scan for new plist files in LaunchAgents ───
LAUNCH_DIR="$HOME/Library/LaunchAgents"
SCAN_DIRS="$HOME/Projects"

python3 << 'PYEOF'
import json
import os
import subprocess
import hashlib
import plistlib
from datetime import datetime, timezone

PROJECT_DIR = os.environ.get("PROJECT_DIR", "")
REGISTRY_PATH = os.path.join(PROJECT_DIR, "public/data/monitor/monitor-registry.json")
CHANGES_PATH = os.path.join(PROJECT_DIR, "public/data/monitor/changes.json")
LAUNCH_DIR = os.path.expanduser("~/Library/LaunchAgents")
SCAN_DIR = os.path.expanduser("~/Projects")
NOW_ISO = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
NOW_EPOCH = int(datetime.now(timezone.utc).timestamp())
SEVEN_DAYS = 604800

with open(REGISTRY_PATH) as f:
    registry = json.load(f)

with open(CHANGES_PATH) as f:
    changes = json.load(f)

known_plist_labels = {s.get("plistLabel") for s in registry if s.get("plistLabel")}
known_script_paths = {s.get("scriptPath") for s in registry if s.get("scriptPath")}

new_changes = []

# ─── Scan LaunchAgents for new plist files ───
if os.path.isdir(LAUNCH_DIR):
    for fname in os.listdir(LAUNCH_DIR):
        if not fname.endswith(".plist"):
            continue
        plist_path = os.path.join(LAUNCH_DIR, fname)
        try:
            with open(plist_path, "rb") as pf:
                plist_data = plistlib.load(pf)
            label = plist_data.get("Label", "")
            if label and label not in known_plist_labels:
                # New service found
                program = plist_data.get("Program", "")
                if not program:
                    prog_args = plist_data.get("ProgramArguments", [])
                    program = prog_args[-1] if prog_args else ""

                svc_type = "unknown"
                if program.endswith(".py"):
                    svc_type = "python"
                elif program.endswith(".js"):
                    svc_type = "node"
                elif program.endswith(".sh"):
                    svc_type = "bash"

                new_svc = {
                    "id": label.replace(".", "-"),
                    "name": label.split(".")[-1].replace("-", " ").title(),
                    "description": "Обнаружен автоматически, требует описания",
                    "project": "Неизвестный",
                    "type": svc_type,
                    "scriptPath": program if program else None,
                    "plistLabel": label,
                    "logPath": None,
                    "lifecycle": "active"
                }
                registry.append(new_svc)
                known_plist_labels.add(label)
                new_changes.append({
                    "time": NOW_ISO,
                    "scriptId": new_svc["id"],
                    "type": "discovered",
                    "details": f"Новый сервис обнаружен: {label}"
                })
        except Exception:
            continue

# ─── Scan Projects for standalone scripts ───
SKIP_DIRS = {"node_modules", ".git", ".next", "venv", "__pycache__", ".venv", "dist", "build"}

if os.path.isdir(SCAN_DIR):
    for root, dirs, files in os.walk(SCAN_DIR):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        # Only go 3 levels deep
        depth = root.replace(SCAN_DIR, "").count(os.sep)
        if depth > 3:
            dirs.clear()
            continue
        for fname in files:
            if not (fname.endswith(".py") or fname.endswith(".js") or fname.endswith(".sh")):
                continue
            fpath = os.path.join(root, fname)
            # Skip if already known or if it's a test/config file
            if fpath in known_script_paths:
                continue
            # Skip small utility files, only track main scripts
            # (We don't auto-add every script, just plist-registered ones)

# ─── Check file hashes for existing entries ───
for svc in registry:
    script_path = svc.get("scriptPath")
    if not script_path or script_path == "null":
        continue

    if not os.path.exists(script_path):
        if svc.get("lifecycle") == "active":
            svc["lifecycle"] = "deleted"
            new_changes.append({
                "time": NOW_ISO,
                "scriptId": svc["id"],
                "type": "deleted",
                "details": f"Файл удалён: {script_path}"
            })
        continue

    # Compute hash
    try:
        h = hashlib.sha256(open(script_path, "rb").read()).hexdigest()[:8]
    except Exception:
        continue

    old_hash = svc.get("fileHash", "")
    if old_hash and old_hash != h:
        new_changes.append({
            "time": NOW_ISO,
            "scriptId": svc["id"],
            "type": "modified",
            "oldHash": old_hash,
            "newHash": h
        })
    svc["fileHash"] = h

    # Check last modified
    try:
        mtime = os.path.getmtime(script_path)
        svc["lastModified"] = datetime.fromtimestamp(mtime, timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        pass

# ─── Mark stale services (not run in 7+ days based on log) ───
for svc in registry:
    if svc.get("lifecycle") not in ("active",):
        continue
    log_path = svc.get("logPath")
    if not log_path or log_path == "null" or not os.path.exists(log_path):
        continue
    try:
        log_mtime = os.path.getmtime(log_path)
        if log_mtime < (NOW_EPOCH - SEVEN_DAYS):
            svc["lifecycle"] = "stale"
            new_changes.append({
                "time": NOW_ISO,
                "scriptId": svc["id"],
                "type": "stale",
                "details": "Лог не обновлялся 7+ дней"
            })
    except Exception:
        pass

# ─── Save results ───
# Merge new changes (max 200 total)
all_changes = new_changes + changes
all_changes = all_changes[:200]

with open(REGISTRY_PATH, "w") as f:
    json.dump(registry, f, ensure_ascii=False, indent=2)

with open(CHANGES_PATH, "w") as f:
    json.dump(all_changes, f, ensure_ascii=False, indent=2)

print(f"Scanner complete: {len(new_changes)} changes detected, {len(registry)} services in registry")
PYEOF
