#!/usr/bin/env bash
# health-collector.sh — Collects status of all registered launchd services
# Output: public/data/monitor/status.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REGISTRY="$PROJECT_DIR/public/data/monitor/monitor-registry.json"
OUTPUT="$PROJECT_DIR/public/data/monitor/status.json"

if [ ! -f "$REGISTRY" ]; then
  echo "Registry not found: $REGISTRY" >&2
  exit 1
fi

NOW_EPOCH=$(date +%s)
NOW_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TODAY=$(date +"%Y-%m-%d")

# Helper: human-readable uptime
format_uptime() {
  local secs=$1
  if [ "$secs" -le 0 ]; then echo "0s"; return; fi
  local d=$((secs / 86400))
  local h=$(( (secs % 86400) / 3600 ))
  local m=$(( (secs % 3600) / 60 ))
  local result=""
  [ "$d" -gt 0 ] && result="${d}d "
  [ "$h" -gt 0 ] && result="${result}${h}h "
  [ "$m" -gt 0 ] && result="${result}${m}m"
  echo "${result:-0m}"
}

# Helper: parse plist schedule
get_schedule_from_plist() {
  local label="$1"
  local plist_path="$HOME/Library/LaunchAgents/${label}.plist"

  if [ ! -f "$plist_path" ]; then
    echo '{"type":"unknown","description":"plist не найден"}'
    return
  fi

  # Check KeepAlive
  if /usr/libexec/PlistBuddy -c "Print :KeepAlive" "$plist_path" 2>/dev/null | grep -qi "true"; then
    echo '{"type":"keepalive","description":"постоянно"}'
    return
  fi

  # Check StartInterval
  local interval
  interval=$(/usr/libexec/PlistBuddy -c "Print :StartInterval" "$plist_path" 2>/dev/null || echo "")
  if [ -n "$interval" ] && [ "$interval" -gt 0 ] 2>/dev/null; then
    local min=$((interval / 60))
    if [ "$min" -ge 60 ]; then
      local hrs=$((min / 60))
      echo "{\"type\":\"interval\",\"intervalMin\":$min,\"description\":\"каждые ${hrs} ч\"}"
    elif [ "$min" -gt 0 ]; then
      echo "{\"type\":\"interval\",\"intervalMin\":$min,\"description\":\"каждые ${min} мин\"}"
    else
      echo "{\"type\":\"interval\",\"intervalSec\":$interval,\"description\":\"каждые ${interval} сек\"}"
    fi
    return
  fi

  # Check StartCalendarInterval
  local hour minute
  hour=$(/usr/libexec/PlistBuddy -c "Print :StartCalendarInterval:Hour" "$plist_path" 2>/dev/null || echo "")
  minute=$(/usr/libexec/PlistBuddy -c "Print :StartCalendarInterval:Minute" "$plist_path" 2>/dev/null || echo "")
  if [ -n "$hour" ]; then
    minute="${minute:-0}"
    printf '{"type":"calendar","hour":%d,"minute":%d,"description":"ежедневно в %02d:%02d"}\n' "$hour" "$minute" "$hour" "$minute"
    return
  fi

  echo '{"type":"unknown","description":"расписание не определено"}'
}

# Helper: calculate next run
calc_next_run() {
  local schedule_json="$1"
  local stype
  stype=$(echo "$schedule_json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('type',''))" 2>/dev/null || echo "")

  case "$stype" in
    interval)
      local imin
      imin=$(echo "$schedule_json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('intervalMin',0))" 2>/dev/null || echo "0")
      if [ "$imin" -gt 0 ]; then
        # Round current time up to next interval
        local now_min=$(( $(date +%s) / 60 ))
        local next_min=$(( ((now_min / imin) + 1) * imin ))
        date -r $((next_min * 60)) -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo ""
      fi
      ;;
    calendar)
      local hour minute
      hour=$(echo "$schedule_json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hour',0))" 2>/dev/null || echo "0")
      minute=$(echo "$schedule_json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('minute',0))" 2>/dev/null || echo "0")
      # Next run is today or tomorrow at that time
      local target_epoch
      target_epoch=$(date -j -f "%Y-%m-%d %H:%M:%S" "$TODAY $hour:$minute:00" +%s 2>/dev/null || echo "0")
      if [ "$target_epoch" -le "$NOW_EPOCH" ]; then
        target_epoch=$((target_epoch + 86400))
      fi
      date -r "$target_epoch" -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo ""
      ;;
    *)
      echo ""
      ;;
  esac
}

# Helper: count errors in last 24h from log
count_errors_24h() {
  local log_path="$1"
  if [ -z "$log_path" ] || [ "$log_path" = "null" ] || [ ! -f "$log_path" ]; then
    echo "0"
    return
  fi
  local cutoff
  cutoff=$(date -v-24H +"%Y-%m-%d %H:%M" 2>/dev/null || date -d "24 hours ago" +"%Y-%m-%d %H:%M" 2>/dev/null || echo "")
  # Just count ERROR/CRITICAL/Exception in last 100 lines
  tail -n 100 "$log_path" 2>/dev/null | grep -ciE "ERROR|CRITICAL|Exception" || echo "0"
}

# Helper: get last errors from log
get_last_errors() {
  local log_path="$1"
  if [ -z "$log_path" ] || [ "$log_path" = "null" ] || [ ! -f "$log_path" ]; then
    echo "[]"
    return
  fi
  tail -n 100 "$log_path" 2>/dev/null | grep -iE "ERROR|CRITICAL|Exception" | tail -n 5 | python3 -c "
import sys, json, re
errors = []
for line in sys.stdin:
    line = line.strip()
    # Try to extract time
    m = re.match(r'(\d{2}:\d{2})', line)
    time_str = m.group(1) if m else ''
    # Truncate message
    msg = line[:200]
    errors.append({'time': time_str, 'message': msg})
print(json.dumps(errors, ensure_ascii=False))
" 2>/dev/null || echo "[]"
}

# Helper: get file hash
get_file_hash() {
  local path="$1"
  if [ -z "$path" ] || [ "$path" = "null" ] || [ ! -f "$path" ]; then
    echo ""
    return
  fi
  shasum -a 256 "$path" 2>/dev/null | cut -d' ' -f1 | head -c 8
}

# Helper: get file last modified
get_last_modified() {
  local path="$1"
  if [ -z "$path" ] || [ "$path" = "null" ] || [ ! -f "$path" ]; then
    echo ""
    return
  fi
  stat -f "%Sm" -t "%Y-%m-%dT%H:%M:%S" "$path" 2>/dev/null || echo ""
}

# Build services array
SERVICES="[]"

COUNT=$(python3 -c "import json; data=json.load(open('$REGISTRY')); print(len(data))")

for i in $(seq 0 $((COUNT - 1))); do
  # Read fields from registry
  eval "$(python3 -c "
import json, sys
data = json.load(open('$REGISTRY'))
s = data[$i]
print(f'SVC_ID={json.dumps(s.get(\"id\",\"\"))}')
print(f'SVC_NAME={json.dumps(s.get(\"name\",\"\"))}')
print(f'SVC_DESC={json.dumps(s.get(\"description\",\"\"))}')
print(f'SVC_PROJECT={json.dumps(s.get(\"project\",\"\"))}')
print(f'SVC_TYPE={json.dumps(s.get(\"type\",\"\"))}')
print(f'SVC_SCRIPT={json.dumps(s.get(\"scriptPath\",\"\"))}')
print(f'SVC_PLIST={json.dumps(s.get(\"plistLabel\",\"\"))}')
print(f'SVC_LOG={json.dumps(s.get(\"logPath\") or \"\")}')
print(f'SVC_LIFECYCLE={json.dumps(s.get(\"lifecycle\",\"active\"))}')
isched = s.get('internalSchedule')
if isched:
    print(f'SVC_INT_SCHED={json.dumps(json.dumps(isched, ensure_ascii=False))}')
else:
    print('SVC_INT_SCHED=\"\"')
")"

  # Skip archived/deleted
  if [ "$SVC_LIFECYCLE" = "archived" ] || [ "$SVC_LIFECYCLE" = "deleted" ]; then
    # Still include but with minimal info
    SERVICE_JSON=$(python3 -c "
import json
svc = {
  'id': $SVC_ID,
  'name': $SVC_NAME,
  'description': $SVC_DESC,
  'project': $SVC_PROJECT,
  'type': $SVC_TYPE,
  'scriptPath': $SVC_SCRIPT if $SVC_SCRIPT else None,
  'plistLabel': $SVC_PLIST,
  'logPath': $SVC_LOG if $SVC_LOG else None,
  'status': '$SVC_LIFECYCLE',
  'pid': None,
  'uptime': '',
  'uptimeSeconds': 0,
  'lastRun': None,
  'nextRun': None,
  'schedule': {'type': 'none', 'description': '—'},
  'runsToday': 0,
  'runsTotal': -1,
  'errorsLast24h': 0,
  'lastErrors': [],
  'fileHash': '',
  'lastModified': None,
  'lifecycle': '$SVC_LIFECYCLE'
}
print(json.dumps(svc, ensure_ascii=False))
")
    SERVICES=$(echo "$SERVICES" | python3 -c "import sys,json; arr=json.load(sys.stdin); arr.append(json.loads('''$SERVICE_JSON''')); print(json.dumps(arr, ensure_ascii=False))")
    continue
  fi

  # Check launchd status
  LAUNCHCTL_INFO=$(launchctl list "$SVC_PLIST" 2>/dev/null || echo "NOT_FOUND")

  SVC_PID=""
  SVC_STATUS="stopped"
  SVC_EXIT_CODE=""
  SVC_UPTIME_SECS=0
  SVC_UPTIME=""

  if [ "$LAUNCHCTL_INFO" != "NOT_FOUND" ]; then
    SVC_PID=$(echo "$LAUNCHCTL_INFO" | awk '/PID/ {print $3}' 2>/dev/null || echo "")
    SVC_EXIT_CODE=$(echo "$LAUNCHCTL_INFO" | awk '/\"LastExitStatus\"/ {gsub(/[^0-9]/,"",$3); print $3}' 2>/dev/null || echo "")

    if [ -n "$SVC_PID" ] && [ "$SVC_PID" != "0" ] && [ "$SVC_PID" != "-" ]; then
      SVC_STATUS="running"
      # Get process start time for uptime
      PROC_START=$(ps -p "$SVC_PID" -o lstart= 2>/dev/null || echo "")
      if [ -n "$PROC_START" ]; then
        START_EPOCH=$(date -j -f "%a %b %d %H:%M:%S %Y" "$PROC_START" +%s 2>/dev/null || echo "$NOW_EPOCH")
        SVC_UPTIME_SECS=$((NOW_EPOCH - START_EPOCH))
        [ "$SVC_UPTIME_SECS" -lt 0 ] && SVC_UPTIME_SECS=0
        SVC_UPTIME=$(format_uptime "$SVC_UPTIME_SECS")
      fi
    else
      # Check exit code for error
      if [ -n "$SVC_EXIT_CODE" ] && [ "$SVC_EXIT_CODE" != "0" ]; then
        SVC_STATUS="error"
      fi
    fi
  fi

  # Use internal schedule if available, otherwise parse plist
  SCHEDULE_JSON=""
  if [ -n "$SVC_INT_SCHED" ]; then
    SCHEDULE_JSON="$SVC_INT_SCHED"
  else
    SCHEDULE_JSON=$(get_schedule_from_plist "$SVC_PLIST")
  fi

  NEXT_RUN=$(calc_next_run "$SCHEDULE_JSON")
  ERROR_COUNT=$(count_errors_24h "$SVC_LOG")
  LAST_ERRORS=$(get_last_errors "$SVC_LOG")
  FILE_HASH=$(get_file_hash "$SVC_SCRIPT")
  LAST_MOD=$(get_last_modified "$SVC_SCRIPT")

  # Build JSON for this service
  SERVICE_JSON=$(python3 -c "
import json
svc = {
  'id': $SVC_ID,
  'name': $SVC_NAME,
  'description': $SVC_DESC,
  'project': $SVC_PROJECT,
  'type': $SVC_TYPE,
  'scriptPath': $SVC_SCRIPT if $SVC_SCRIPT else None,
  'plistLabel': $SVC_PLIST,
  'logPath': $SVC_LOG if $SVC_LOG else None,
  'status': '$SVC_STATUS',
  'pid': int('$SVC_PID') if '$SVC_PID'.isdigit() and int('$SVC_PID') > 0 else None,
  'uptime': '$SVC_UPTIME',
  'uptimeSeconds': $SVC_UPTIME_SECS,
  'lastRun': None,
  'nextRun': '$NEXT_RUN' if '$NEXT_RUN' else None,
  'schedule': json.loads('''$SCHEDULE_JSON''') if '''$SCHEDULE_JSON''' else {'type':'unknown','description':'—'},
  'runsToday': -1,
  'runsTotal': -1,
  'errorsLast24h': int('$ERROR_COUNT') if '$ERROR_COUNT'.isdigit() else 0,
  'lastErrors': json.loads('''$LAST_ERRORS'''),
  'fileHash': '$FILE_HASH' or None,
  'lastModified': '$LAST_MOD' or None,
  'lifecycle': '$SVC_LIFECYCLE'
}
print(json.dumps(svc, ensure_ascii=False))
")

  SERVICES=$(echo "$SERVICES" | python3 -c "
import sys, json
arr = json.load(sys.stdin)
arr.append(json.loads('''$SERVICE_JSON'''))
print(json.dumps(arr, ensure_ascii=False))
")
done

# Write final output
python3 -c "
import json
services = json.loads('''$SERVICES''')
result = {
  'timestamp': '$NOW_ISO',
  'machine': 'MacBook Air',
  'services': services
}
with open('$OUTPUT', 'w') as f:
  json.dump(result, f, ensure_ascii=False, indent=2)
print(json.dumps(result, ensure_ascii=False, indent=2))
"
