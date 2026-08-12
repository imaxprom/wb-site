\set ON_ERROR_STOP on

-- Durable state for FBS supplies delivered through a WB pickup point.
-- The state is tenant-local, just like the rest of the FBS workflow.
BEGIN;

ALTER TABLE public.fbs_fulfillment_supplies
  ADD COLUMN IF NOT EXISTS box_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS box_stickers_printed_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS box_stickers_printed_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS box_stickers_printed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pvz_rules_confirmed_at TIMESTAMPTZ;

ALTER TABLE public.fbs_print_job_items
  ADD COLUMN IF NOT EXISTS reference_id TEXT NOT NULL DEFAULT '';

DO $tenant_columns$
DECLARE org RECORD;
BEGIN
  FOR org IN SELECT id,data_schema FROM public.organizations WHERE data_schema <> 'public' LOOP
    IF org.data_schema <> format('organization_%s', org.id) THEN
      RAISE EXCEPTION 'Invalid organization schema %', org.data_schema;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I.fbs_fulfillment_supplies '
      'ADD COLUMN IF NOT EXISTS box_ids JSONB NOT NULL DEFAULT ''[]''::jsonb, '
      'ADD COLUMN IF NOT EXISTS box_stickers_printed_ids JSONB NOT NULL DEFAULT ''[]''::jsonb, '
      'ADD COLUMN IF NOT EXISTS box_stickers_printed_count INTEGER NOT NULL DEFAULT 0, '
      'ADD COLUMN IF NOT EXISTS box_stickers_printed_at TIMESTAMPTZ, '
      'ADD COLUMN IF NOT EXISTS pvz_rules_confirmed_at TIMESTAMPTZ',
      org.data_schema
    );
    EXECUTE format(
      'ALTER TABLE %I.fbs_print_job_items ADD COLUMN IF NOT EXISTS reference_id TEXT NOT NULL DEFAULT ''''',
      org.data_schema
    );
  END LOOP;
END
$tenant_columns$;

COMMIT;
