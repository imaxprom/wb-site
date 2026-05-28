#!/usr/bin/env python3
import os
import sqlite3
import time
from io import StringIO

import psycopg2


SQLITE_PATH = os.environ.get("SQLITE_PATH", "/tmp/mphub-supplies.sqlite")
CREDENTIALS = os.environ.get("MPHUB_PG_CREDENTIALS", "/etc/mphub/postgres-credentials.env")
BATCH_ROWS = int(os.environ.get("BATCH_ROWS", "5000"))
TABLES = ("wb_supply_snapshots", "wb_accepted_supplies", "wb_accepted_supply_contents")


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


def text_copy_value(value):
    if value is None:
        return r"\N"
    if isinstance(value, bytes):
        return r"\\x" + value.hex()
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace("\t", "\\t")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    )


def table_exists(sdb, table):
    row = sdb.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def create_schema(cur):
    cur.execute("DROP TABLE IF EXISTS wb_accepted_supply_contents")
    cur.execute("DROP TABLE IF EXISTS wb_accepted_supplies")
    cur.execute("DROP TABLE IF EXISTS wb_supply_snapshots")
    cur.execute("""
        CREATE TABLE wb_supply_snapshots (
          supply_id BIGINT PRIMARY KEY,
          preorder_id BIGINT,
          status_id BIGINT,
          virtual_type_id BIGINT,
          box_type_id BIGINT,
          create_date TEXT,
          supply_date TEXT,
          fact_date TEXT,
          updated_date TEXT,
          warehouse_name TEXT,
          actual_warehouse_name TEXT,
          quantity BIGINT,
          accepted_quantity BIGINT,
          list_position BIGINT NOT NULL DEFAULT 0,
          row_json TEXT NOT NULL,
          detail_json TEXT,
          saved_at TEXT NOT NULL,
          refreshed_at TEXT NOT NULL
        )
    """)
    cur.execute("""
        CREATE TABLE wb_accepted_supplies (
          supply_id BIGINT PRIMARY KEY,
          preorder_id BIGINT,
          status_id BIGINT,
          virtual_type_id BIGINT,
          box_type_id BIGINT,
          create_date TEXT,
          supply_date TEXT,
          fact_date TEXT,
          updated_date TEXT,
          warehouse_name TEXT,
          actual_warehouse_name TEXT,
          quantity BIGINT,
          accepted_quantity BIGINT,
          row_json TEXT NOT NULL,
          detail_json TEXT NOT NULL,
          saved_at TEXT NOT NULL,
          refreshed_at TEXT NOT NULL
        )
    """)
    cur.execute("""
        CREATE TABLE wb_accepted_supply_contents (
          supply_id BIGINT PRIMARY KEY REFERENCES wb_accepted_supplies(supply_id),
          source TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          saved_at TEXT NOT NULL,
          refreshed_at TEXT NOT NULL
        )
    """)


def sqlite_columns(sdb, table):
    return [row[1] for row in sdb.execute(f"PRAGMA table_info({qi(table)})").fetchall()]


def copy_table(sdb, pcur, table):
    if not table_exists(sdb, table):
        print(f"{table}: skipped, table missing", flush=True)
        return 0

    cols = sqlite_columns(sdb, table)
    select_sql = "SELECT " + ", ".join(qi(c) for c in cols) + " FROM " + qi(table)
    copy_sql = (
        "COPY "
        + qi(table)
        + " ("
        + ", ".join(qi(c) for c in cols)
        + ") FROM STDIN WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N')"
    )

    scur = sdb.execute(select_sql)
    total = 0
    start = time.time()
    while True:
        rows = scur.fetchmany(BATCH_ROWS)
        if not rows:
            break
        buf = StringIO()
        for row in rows:
            buf.write("\t".join(text_copy_value(v) for v in row))
            buf.write("\n")
        buf.seek(0)
        pcur.copy_expert(copy_sql, buf)
        total += len(rows)
    print(f"{table}: copied {total} rows in {time.time() - start:.1f}s", flush=True)
    return total


def grant_access(cur):
    cur.execute("GRANT SELECT ON wb_supply_snapshots, wb_accepted_supplies, wb_accepted_supply_contents TO mphub_readonly")
    cur.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON wb_supply_snapshots, wb_accepted_supplies, wb_accepted_supply_contents TO mphub_app")
    cur.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON wb_supply_snapshots, wb_accepted_supplies, wb_accepted_supply_contents TO mphub_migrator")


def main():
    creds = read_env_file(CREDENTIALS)
    sdb = sqlite3.connect(SQLITE_PATH)

    pconn = psycopg2.connect(
        dbname=creds["MPHUB_DB_NAME"],
        user=creds["MPHUB_MIGRATOR_USER"],
        password=creds["MPHUB_MIGRATOR_PASSWORD"],
        host="127.0.0.1",
        port=5432,
    )
    pconn.autocommit = False
    with pconn.cursor() as pcur:
        create_schema(pcur)
        pconn.commit()
        for table in TABLES:
            copy_table(sdb, pcur, table)
            pconn.commit()
        grant_access(pcur)
        pconn.commit()

    pconn.close()
    sdb.close()
    print("Supplies migration complete", flush=True)


if __name__ == "__main__":
    main()
