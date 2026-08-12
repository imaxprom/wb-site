\set ON_ERROR_STOP on

-- MpHub multi-organization foundation.
-- This migration is intentionally additive: it does not remove or rename any
-- existing column, table, index, key, or file-backed credential.

BEGIN;

CREATE TABLE IF NOT EXISTS organizations (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  inn TEXT,
  supplier_id TEXT,
  store_name TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'setup')),
  data_schema TEXT NOT NULL UNIQUE
    CHECK (data_schema = 'public' OR data_schema ~ '^organization_[1-9][0-9]*$'),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_single_default_idx
  ON organizations (is_default)
  WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS organization_members_user_idx
  ON organization_members (user_id, status, organization_id);

CREATE TABLE IF NOT EXISTS organization_credentials (
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, credential_type)
);

CREATE TABLE IF NOT EXISTS organization_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ,
  rows_read BIGINT NOT NULL DEFAULT 0,
  rows_written BIGINT NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS organization_sync_runs_lookup_idx
  ON organization_sync_runs (organization_id, job_name, started_at DESC);

INSERT INTO organizations (
  id, slug, display_name, legal_name, inn, supplier_id, store_name, status, data_schema, is_default
)
SELECT
  1,
  'main',
  COALESCE(NULLIF(store_name, ''), NULLIF(name, ''), 'Основной кабинет'),
  COALESCE(NULLIF(name, ''), 'Основное юридическое лицо'),
  NULLIF(inn, ''),
  NULLIF(supplier_id, ''),
  NULLIF(store_name, ''),
  'active',
  'public',
  TRUE
FROM review_accounts
ORDER BY id
LIMIT 1
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  legal_name = EXCLUDED.legal_name,
  inn = COALESCE(organizations.inn, EXCLUDED.inn),
  supplier_id = COALESCE(organizations.supplier_id, EXCLUDED.supplier_id),
  store_name = COALESCE(organizations.store_name, EXCLUDED.store_name),
  data_schema = 'public',
  is_default = TRUE,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO organizations (
  id, slug, display_name, legal_name, status, data_schema, is_default
)
SELECT 1, 'main', 'Основной кабинет', 'Основное юридическое лицо', 'active', 'public', TRUE
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE id = 1)
ON CONFLICT (id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('organizations', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM organizations), 1),
  TRUE
);

INSERT INTO organization_members (organization_id, user_id, role, status)
SELECT 1, id, CASE WHEN role = 'admin' THEN 'owner' ELSE 'member' END, 'active'
FROM users
WHERE role <> 'disabled'
ON CONFLICT (organization_id, user_id) DO UPDATE SET
  role = EXCLUDED.role,
  status = 'active',
  updated_at = CURRENT_TIMESTAMP;

-- Business data is isolated by PostgreSQL schema. The current legal entity stays
-- in public byte-for-byte; subsequent entities receive empty structural clones.
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
    'advertising',
    'buyout_rates',
    'campaign_nm_map',
    'cogs',
    'cogs_history',
    'orders',
    'orders_funnel',
    'paid_storage',
    'product_overrides',
    'realization',
    'realization_dedupe_backup_20260626',
    'realization_report_meta',
    'reports',
    'review_accounts',
    'review_complaint_pauses',
    'review_complaints',
    'review_stats',
    'reviews',
    'reviews_archive_sync_state',
    'settings',
    'shipment_meta',
    'shipment_orders',
    'shipment_products',
    'shipment_stock',
    'sync_status',
    'tax_settings',
    'user_settings',
    'warehouse_measurements',
    'warehouse_ready_stock',
    'warehouse_remains_volume',
    'warehouse_sync_runs',
    'wb_accepted_supplies',
    'wb_accepted_supply_contents',
    'wb_cart_stock_jobs',
    'wb_cart_stock_snapshots',
    'wb_supply_contents',
    'wb_supply_report_documents',
    'wb_supply_snapshots',
    'weekly_buyout_stats',
    'weekly_import_status',
    'weekly_rows'
  ];
BEGIN
  SELECT data_schema INTO target_schema
  FROM public.organizations
  WHERE id = target_organization_id;

  IF target_schema IS NULL THEN
    RAISE EXCEPTION 'Organization % does not exist', target_organization_id;
  END IF;
  IF target_organization_id = 1 AND target_schema = 'public' THEN
    RETURN target_schema;
  END IF;
  IF target_schema <> format('organization_%s', target_organization_id) THEN
    RAISE EXCEPTION 'Invalid schema % for organization %', target_schema, target_organization_id;
  END IF;

  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', target_schema);

  FOREACH table_name IN ARRAY tenant_tables LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      RAISE EXCEPTION 'Source tenant table public.% does not exist', table_name;
    END IF;
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.%I (LIKE public.%I INCLUDING ALL)',
      target_schema,
      table_name,
      table_name
    );
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
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mphub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO mphub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO mphub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_credentials TO mphub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_sync_runs TO mphub_app;
    GRANT USAGE, SELECT ON SEQUENCE public.organizations_id_seq TO mphub_app;
    GRANT USAGE, SELECT ON SEQUENCE public.organization_sync_runs_id_seq TO mphub_app;
    GRANT EXECUTE ON FUNCTION public.mphub_provision_organization_schema(BIGINT) TO mphub_app;
  END IF;
END
$grants$;

COMMIT;
