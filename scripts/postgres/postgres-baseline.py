#!/usr/bin/env python3
import json
import os
from decimal import Decimal

import psycopg2


def read_env_file(path):
    values = {}
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key] = value.strip().strip('"').strip("'")
    return values


def qi(name):
    return '"' + str(name).replace('"', '""') + '"'


def clean_value(value):
    if isinstance(value, Decimal):
        return float(value)
    return value


creds = read_env_file("/etc/mphub/postgres-credentials.env")
with open("/tmp/mphub-sqlite-baseline.json", "r", encoding="utf-8") as fh:
    sqlite_baseline = json.load(fh)

conn = psycopg2.connect(
    dbname=creds["MPHUB_DB_NAME"],
    user=creds["MPHUB_MIGRATOR_USER"],
    password=creds["MPHUB_MIGRATOR_PASSWORD"],
    host="127.0.0.1",
    port=5432,
)

result = {"tables": {}}
with conn.cursor() as cur:
    for table, meta in sqlite_baseline["tables"].items():
        cur.execute(f"SELECT count(*) FROM {qi(table)}")
        count = cur.fetchone()[0]
        result["tables"][table] = {"count": count, "dateRanges": {}, "numericSums": {}}

        for col in meta.get("dateRanges", {}).keys():
            cur.execute(f"SELECT min({qi(col)}), max({qi(col)}) FROM {qi(table)}")
            mn, mx = cur.fetchone()
            result["tables"][table]["dateRanges"][col] = {"min": clean_value(mn), "max": clean_value(mx)}

        for col in meta.get("numericSums", {}).keys():
            cur.execute(f"SELECT round(coalesce(sum({qi(col)}),0)::numeric, 6) FROM {qi(table)}")
            result["tables"][table]["numericSums"][col] = clean_value(cur.fetchone()[0])

print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
