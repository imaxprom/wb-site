\set ON_ERROR_STOP on

-- Honest Sign GTIN is not necessarily the WB product barcode. Keep an
-- explicit, tenant-isolated mapping to the exact WB article and size.
BEGIN;

CREATE TABLE IF NOT EXISTS public.fbs_kiz_gtin_mappings (
  gtin TEXT PRIMARY KEY CHECK (gtin ~ '^[0-9]{14}$'),
  nm_id BIGINT NOT NULL,
  chrt_id BIGINT NOT NULL DEFAULT 0,
  barcode TEXT NOT NULL,
  vendor_code TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  size_name TEXT NOT NULL DEFAULT '',
  created_by_user_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS fbs_kiz_gtin_mappings_variant_idx
  ON public.fbs_kiz_gtin_mappings (nm_id,barcode);

DO $clone_existing$
DECLARE org RECORD;
BEGIN
  FOR org IN SELECT id,data_schema FROM public.organizations WHERE data_schema <> 'public' LOOP
    IF org.data_schema <> format('organization_%s', org.id) THEN
      RAISE EXCEPTION 'Invalid schema % for organization %', org.data_schema, org.id;
    END IF;
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.fbs_kiz_gtin_mappings (LIKE public.fbs_kiz_gtin_mappings INCLUDING ALL)',
      org.data_schema
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS fbs_kiz_gtin_mappings_variant_idx ON %I.fbs_kiz_gtin_mappings (nm_id,barcode)',
      org.data_schema
    );
  END LOOP;
END
$clone_existing$;

-- Keep future organization provisioning structurally complete.
CREATE OR REPLACE FUNCTION public.mphub_provision_organization_schema(target_organization_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $provision$
DECLARE
  target_schema TEXT;
  table_name TEXT;
  tenant_tables TEXT[] := ARRAY[
    'advertising', 'buyout_rates', 'campaign_nm_map', 'cogs', 'cogs_history',
    'fbs_fulfillment_events', 'fbs_fulfillment_orders', 'fbs_fulfillment_scans', 'fbs_fulfillment_supplies',
    'fbs_kiz_archive', 'fbs_kiz_archive_events', 'fbs_kiz_gtin_mappings', 'fbs_marking_queue',
    'fbs_print_agents', 'fbs_print_job_items', 'fbs_print_jobs',
    'fbs_stock_audit', 'fbs_stock_orders', 'fbs_stock_products', 'fbs_stock_warehouses',
    'orders', 'orders_funnel', 'paid_storage', 'product_overrides', 'realization',
    'realization_dedupe_backup_20260626', 'realization_report_meta', 'reports',
    'review_accounts', 'review_complaint_pauses', 'review_complaints',
    'review_stats', 'reviews', 'reviews_archive_sync_state', 'settings',
    'shipment_meta', 'shipment_orders', 'shipment_products', 'shipment_stock',
    'sync_status', 'tax_settings', 'user_settings', 'warehouse_measurements',
    'warehouse_ready_stock', 'warehouse_remains_volume', 'warehouse_sync_runs',
    'wb_accepted_supplies', 'wb_accepted_supply_contents', 'wb_cart_stock_jobs',
    'wb_cart_stock_snapshots', 'wb_supply_contents', 'wb_supply_report_documents',
    'wb_supply_snapshots', 'weekly_buyout_stats', 'weekly_import_status', 'weekly_rows'
  ];
BEGIN
  SELECT data_schema INTO target_schema FROM public.organizations WHERE id = target_organization_id;
  IF target_schema IS NULL THEN RAISE EXCEPTION 'Organization % does not exist', target_organization_id; END IF;
  IF target_organization_id = 1 AND target_schema = 'public' THEN RETURN target_schema; END IF;
  IF target_schema <> format('organization_%s', target_organization_id) THEN
    RAISE EXCEPTION 'Invalid schema % for organization %', target_schema, target_organization_id;
  END IF;
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', target_schema);
  FOREACH table_name IN ARRAY tenant_tables LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      RAISE EXCEPTION 'Source tenant table public.% does not exist', table_name;
    END IF;
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.%I (LIKE public.%I INCLUDING ALL)',
      target_schema, table_name, table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mphub_app') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO mphub_app', target_schema);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO mphub_app', target_schema);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO mphub_app', target_schema);
  END IF;
  RETURN target_schema;
END
$provision$;

REVOKE ALL ON FUNCTION public.mphub_provision_organization_schema(BIGINT) FROM PUBLIC;

DO $grants$
DECLARE org RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mphub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.fbs_kiz_gtin_mappings TO mphub_app;
    GRANT EXECUTE ON FUNCTION public.mphub_provision_organization_schema(BIGINT) TO mphub_app;
    FOR org IN SELECT data_schema FROM public.organizations WHERE data_schema <> 'public' LOOP
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO mphub_app', org.data_schema);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.fbs_kiz_gtin_mappings TO mphub_app', org.data_schema);
    END LOOP;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mphub_readonly') THEN
    GRANT SELECT ON public.fbs_kiz_gtin_mappings TO mphub_readonly;
    FOR org IN SELECT data_schema FROM public.organizations WHERE data_schema <> 'public' LOOP
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO mphub_readonly', org.data_schema);
      EXECUTE format('GRANT SELECT ON %I.fbs_kiz_gtin_mappings TO mphub_readonly', org.data_schema);
    END LOOP;
  END IF;
END
$grants$;

COMMIT;
