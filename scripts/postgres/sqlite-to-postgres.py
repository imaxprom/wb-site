#!/usr/bin/env python3
import os
import re
import sqlite3
import sys
import time
from io import StringIO

import psycopg2


SQLITE_PATH = os.environ.get("SQLITE_PATH", "/tmp/mphub-finance-migration.sqlite")
CREDENTIALS = os.environ.get("MPHUB_PG_CREDENTIALS", "/etc/mphub/postgres-credentials.env")
BATCH_ROWS = int(os.environ.get("BATCH_ROWS", "10000"))


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


def ql(value):
    return "'" + str(value).replace("'", "''") + "'"


def pg_type(sqlite_type, is_pk):
    t = (sqlite_type or "").upper()
    if "INT" in t:
        return "bigint"
    if any(x in t for x in ("REAL", "FLOA", "DOUB")):
        return "double precision"
    if any(x in t for x in ("NUM", "DEC", "BOOL")):
        return "numeric"
    if "BLOB" in t:
        return "bytea"
    return "text"


def pg_default(default):
    if default is None:
        return ""
    d = str(default).strip()
    upper = d.upper()
    if upper in ("CURRENT_TIMESTAMP", "CURRENT_DATE", "CURRENT_TIME"):
        return f" DEFAULT {upper}"
    if re.fullmatch(r"-?\d+(\.\d+)?", d):
        return f" DEFAULT {d}"
    if (d.startswith("'") and d.endswith("'")) or (d.startswith('"') and d.endswith('"')):
        return " DEFAULT " + ql(d[1:-1])
    return ""


def text_copy_value(value):
    if value is None:
        return r"\N"
    if isinstance(value, bytes):
        return r"\\x" + value.hex()
    s = str(value)
    return (
        s.replace("\\", "\\\\")
        .replace("\t", "\\t")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
    )


def fetch_sqlite_schema(sdb):
    tables = [
        r[0]
        for r in sdb.execute(
            "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name"
        ).fetchall()
    ]
    schema = {}
    for table in tables:
        cols = []
        for c in sdb.execute(f"pragma table_info({qi(table)})").fetchall():
            cols.append(
                {
                    "cid": c[0],
                    "name": c[1],
                    "type": c[2],
                    "notnull": bool(c[3]),
                    "default": c[4],
                    "pk": int(c[5] or 0),
                }
            )
        indexes = []
        for idx in sdb.execute(f"pragma index_list({qi(table)})").fetchall():
            idx_name = idx[1]
            unique = bool(idx[2])
            origin = idx[3] if len(idx) > 3 else ""
            if origin == "pk":
                continue
            idx_cols = [r[2] for r in sdb.execute(f"pragma index_info({qi(idx_name)})").fetchall()]
            if idx_cols:
                indexes.append({"name": idx_name, "unique": unique, "cols": idx_cols})
        schema[table] = {"cols": cols, "indexes": indexes}
    return schema


def create_schema(pcur, schema):
    pcur.execute("DROP SCHEMA public CASCADE")
    pcur.execute("CREATE SCHEMA public")
    pcur.execute("GRANT USAGE, CREATE ON SCHEMA public TO mphub_app")
    pcur.execute("GRANT USAGE, CREATE ON SCHEMA public TO mphub_migrator")
    pcur.execute("GRANT USAGE ON SCHEMA public TO mphub_readonly")

    for table, meta in schema.items():
        pk_cols = [c["name"] for c in sorted(meta["cols"], key=lambda c: c["pk"]) if c["pk"]]
        parts = []
        for col in meta["cols"]:
            col_type = pg_type(col["type"], bool(col["pk"]))
            not_null = " NOT NULL" if col["notnull"] or col["pk"] else ""
            default = pg_default(col["default"])
            parts.append(f"{qi(col['name'])} {col_type}{default}{not_null}")
        if pk_cols:
            parts.append("PRIMARY KEY (" + ", ".join(qi(c) for c in pk_cols) + ")")
        pcur.execute(f"CREATE TABLE {qi(table)} ({', '.join(parts)})")


def copy_table(sdb, pcur, table, cols):
    col_names = [c["name"] for c in cols]
    select_sql = "SELECT " + ", ".join(qi(c) for c in col_names) + " FROM " + qi(table)
    copy_sql = (
        "COPY "
        + qi(table)
        + " ("
        + ", ".join(qi(c) for c in col_names)
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
        if total and total % 100000 == 0:
            print(f"{table}: copied {total} rows in {time.time() - start:.1f}s", flush=True)
    print(f"{table}: copied {total} rows in {time.time() - start:.1f}s", flush=True)
    return total


def create_indexes_and_sequences(pcur, schema):
    for table, meta in schema.items():
        for idx in meta["indexes"]:
            idx_name = idx["name"]
            cols = idx["cols"]
            unique = "UNIQUE " if idx["unique"] else ""
            pcur.execute(
                f"CREATE {unique}INDEX IF NOT EXISTS {qi(idx_name)} ON {qi(table)} ("
                + ", ".join(qi(c) for c in cols)
                + ")"
            )

        pk_cols = [c for c in meta["cols"] if c["pk"]]
        if len(pk_cols) == 1 and "INT" in (pk_cols[0]["type"] or "").upper():
            col = pk_cols[0]["name"]
            seq = f"{table}_{col}_seq"
            pcur.execute(f"CREATE SEQUENCE IF NOT EXISTS {qi(seq)} OWNED BY {qi(table)}.{qi(col)}")
            pcur.execute(
                f"SELECT setval({ql(seq)}, COALESCE((SELECT MAX({qi(col)}) FROM {qi(table)}), 0) + 1, false)"
            )
            pcur.execute(f"ALTER TABLE {qi(table)} ALTER COLUMN {qi(col)} SET DEFAULT nextval({ql(seq)})")

    pcur.execute("GRANT SELECT ON ALL TABLES IN SCHEMA public TO mphub_readonly")
    pcur.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mphub_readonly")
    pcur.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mphub_app")
    pcur.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO mphub_app")
    pcur.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mphub_migrator")
    pcur.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO mphub_migrator")


def main():
    creds = read_env_file(CREDENTIALS)
    sdb = sqlite3.connect(SQLITE_PATH)
    sdb.row_factory = None
    schema = fetch_sqlite_schema(sdb)
    print(f"SQLite tables: {len(schema)}", flush=True)

    pconn = psycopg2.connect(
        dbname=creds["MPHUB_DB_NAME"],
        user=creds["MPHUB_MIGRATOR_USER"],
        password=creds["MPHUB_MIGRATOR_PASSWORD"],
        host="127.0.0.1",
        port=5432,
    )
    pconn.autocommit = False
    with pconn.cursor() as pcur:
        if os.environ.get("FINALIZE_ONLY") == "1":
            print("Finalizing indexes, sequences and grants only...", flush=True)
            create_indexes_and_sequences(pcur, schema)
            pconn.commit()
            return

        print("Creating PostgreSQL schema...", flush=True)
        create_schema(pcur, schema)
        pconn.commit()

        copied = {}
        for table, meta in schema.items():
            copied[table] = copy_table(sdb, pcur, table, meta["cols"])
            pconn.commit()

        print("Creating indexes, sequences and grants...", flush=True)
        create_indexes_and_sequences(pcur, schema)
        pconn.commit()

    pconn.close()
    sdb.close()
    print("Migration copy complete", flush=True)


if __name__ == "__main__":
    main()
