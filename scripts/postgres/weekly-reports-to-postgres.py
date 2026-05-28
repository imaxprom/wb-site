#!/usr/bin/env python3
import os
import sqlite3
import time
from io import StringIO

import psycopg2


SQLITE_PATH = os.environ.get("SQLITE_PATH", "/tmp/mphub-weekly-reports.sqlite")
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


def create_schema(cur):
    cur.execute("DROP TABLE IF EXISTS weekly_rows CASCADE")
    cur.execute("DROP TABLE IF EXISTS reports CASCADE")
    cur.execute("""
        CREATE TABLE reports (
          id bigint PRIMARY KEY,
          report_id bigint NOT NULL UNIQUE,
          report_type bigint NOT NULL,
          period_from text NOT NULL,
          period_to text NOT NULL,
          rows_count bigint NOT NULL,
          loaded_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE weekly_rows (
          id bigint PRIMARY KEY,
          report_id bigint NOT NULL,
          report_type bigint NOT NULL,
          period_from text NOT NULL,
          period_to text NOT NULL,
          row_num text,
          supply_id text,
          subject text,
          nm_id text,
          brand text,
          sa_name text,
          product_name text,
          size text,
          barcode text,
          doc_type text,
          supplier_oper_name text,
          order_dt text,
          sale_dt text,
          quantity double precision,
          retail_price double precision,
          retail_amount double precision,
          product_discount_pct double precision,
          promo_code_pct double precision,
          total_discount_pct double precision,
          retail_price_withdisc_rub double precision,
          kvv_rating_reduction_pct double precision,
          kvv_promo_change_pct double precision,
          spp_pct double precision,
          kvv_pct double precision,
          kvv_base_no_vat_pct double precision,
          kvv_final_no_vat_pct double precision,
          ppvz_sales_commission double precision,
          ppvz_pvz_reward double precision,
          acquiring_fee double precision,
          acquiring_pct double precision,
          acquiring_type text,
          vv_no_vat double precision,
          vv_vat double precision,
          ppvz_for_pay double precision,
          delivery_amount double precision,
          return_amount double precision,
          delivery_rub double precision,
          fix_date_from text,
          fix_date_to text,
          paid_delivery_flag text,
          penalty double precision,
          vv_correction double precision,
          operation_type text,
          sticker_mp text,
          acquiring_bank text,
          office_id text,
          office_name text,
          partner_inn text,
          partner text,
          warehouse text,
          country text,
          box_type text,
          customs_declaration text,
          assembly_id text,
          marking_code text,
          shk text,
          srid text,
          rebill_logistic_cost double precision,
          carrier text,
          storage_fee double precision,
          deduction double precision,
          acceptance double precision,
          chrt_id bigint,
          warehouse_coeff double precision,
          b2b_flag text,
          tmc_flag text,
          box_num text,
          cofinancing_discount double precision,
          wibes_discount_pct double precision,
          loyalty_compensation double precision,
          loyalty_participation_cost double precision,
          loyalty_points_deduction double precision,
          cart_id text,
          additional_payment text,
          sale_method text,
          seller_promo_id double precision,
          seller_promo_pct double precision,
          seller_loyalty_id double precision,
          seller_loyalty_pct double precision,
          promo_id text,
          promo_discount_pct double precision
        )
    """)


def sqlite_columns(sdb, table):
    return [row[1] for row in sdb.execute(f"PRAGMA table_info({qi(table)})").fetchall()]


def copy_table(sdb, pcur, table):
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
        if total % 100000 == 0:
            print(f"{table}: copied {total} rows in {time.time() - start:.1f}s", flush=True)
    print(f"{table}: copied {total} rows in {time.time() - start:.1f}s", flush=True)
    return total


def create_indexes_and_grants(cur):
    cur.execute("CREATE INDEX idx_wr_period ON weekly_rows(period_from, period_to)")
    cur.execute("CREATE INDEX idx_wr_report ON weekly_rows(report_id)")
    cur.execute("CREATE INDEX idx_wr_barcode ON weekly_rows(barcode)")
    cur.execute("CREATE INDEX idx_wr_nm ON weekly_rows(nm_id)")
    cur.execute("CREATE INDEX idx_wr_oper ON weekly_rows(supplier_oper_name)")
    cur.execute("CREATE INDEX idx_wr_sale_dt ON weekly_rows(sale_dt)")
    cur.execute("CREATE INDEX idx_wr_oper_srid ON weekly_rows(supplier_oper_name, srid)")
    cur.execute("CREATE INDEX idx_wr_saledt_oper ON weekly_rows(sale_dt, supplier_oper_name)")
    cur.execute("CREATE SEQUENCE IF NOT EXISTS reports_id_seq OWNED BY reports.id")
    cur.execute("SELECT setval('reports_id_seq', COALESCE((SELECT MAX(id) FROM reports), 0) + 1, false)")
    cur.execute("ALTER TABLE reports ALTER COLUMN id SET DEFAULT nextval('reports_id_seq')")
    cur.execute("CREATE SEQUENCE IF NOT EXISTS weekly_rows_id_seq OWNED BY weekly_rows.id")
    cur.execute("SELECT setval('weekly_rows_id_seq', COALESCE((SELECT MAX(id) FROM weekly_rows), 0) + 1, false)")
    cur.execute("ALTER TABLE weekly_rows ALTER COLUMN id SET DEFAULT nextval('weekly_rows_id_seq')")
    cur.execute("GRANT SELECT ON reports, weekly_rows TO mphub_readonly")
    cur.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON reports, weekly_rows TO mphub_app")
    cur.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON reports, weekly_rows TO mphub_migrator")
    cur.execute("GRANT USAGE, SELECT ON SEQUENCE reports_id_seq, weekly_rows_id_seq TO mphub_readonly")
    cur.execute("GRANT USAGE, SELECT, UPDATE ON SEQUENCE reports_id_seq, weekly_rows_id_seq TO mphub_app")
    cur.execute("GRANT USAGE, SELECT, UPDATE ON SEQUENCE reports_id_seq, weekly_rows_id_seq TO mphub_migrator")


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
        print("Creating weekly reports PostgreSQL tables...", flush=True)
        create_schema(pcur)
        pconn.commit()
        copy_table(sdb, pcur, "reports")
        pconn.commit()
        copy_table(sdb, pcur, "weekly_rows")
        pconn.commit()
        print("Creating weekly reports indexes and grants...", flush=True)
        create_indexes_and_grants(pcur)
        pconn.commit()

    pconn.close()
    sdb.close()
    print("Weekly reports migration complete", flush=True)


if __name__ == "__main__":
    main()
