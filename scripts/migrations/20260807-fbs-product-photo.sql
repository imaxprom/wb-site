\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE public.fbs_stock_products
  ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT '';

DO $tenant_photos$
DECLARE
  org RECORD;
BEGIN
  FOR org IN
    SELECT id, data_schema
    FROM public.organizations
    WHERE data_schema <> 'public'
  LOOP
    IF org.data_schema <> format('organization_%s', org.id) THEN
      RAISE EXCEPTION 'Invalid schema % for organization %', org.data_schema, org.id;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.fbs_stock_products ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT %L',
      org.data_schema,
      ''
    );
  END LOOP;
END
$tenant_photos$;

COMMIT;
