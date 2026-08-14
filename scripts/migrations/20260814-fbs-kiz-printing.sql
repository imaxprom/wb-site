\set ON_ERROR_STOP on

-- Batch printing for the organization-isolated archive of applied KIZ codes.
-- A code is reserved before it enters the durable printer queue. After the
-- print-agent confirms the physical Windows job, both encrypted source and
-- rendered label payload are erased while hashes and audit metadata remain.
BEGIN;

DO $upgrade$
DECLARE org RECORD;
BEGIN
  FOR org IN SELECT data_schema FROM public.organizations LOOP
    EXECUTE format('ALTER TABLE %I.fbs_kiz_archive ADD COLUMN IF NOT EXISTS print_state TEXT NOT NULL DEFAULT ''available''', org.data_schema);
    EXECUTE format('ALTER TABLE %I.fbs_kiz_archive ADD COLUMN IF NOT EXISTS print_job_id TEXT', org.data_schema);
    EXECUTE format('ALTER TABLE %I.fbs_kiz_archive ADD COLUMN IF NOT EXISTS print_position INTEGER', org.data_schema);
    EXECUTE format('ALTER TABLE %I.fbs_kiz_archive ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ', org.data_schema);
    EXECUTE format('ALTER TABLE %I.fbs_kiz_archive ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ', org.data_schema);
    EXECUTE format('ALTER TABLE %I.fbs_kiz_archive ADD COLUMN IF NOT EXISTS printed_by_user_id BIGINT', org.data_schema);
    EXECUTE format('ALTER TABLE %I.fbs_kiz_archive DROP CONSTRAINT IF EXISTS fbs_kiz_archive_print_state_check', org.data_schema);
    EXECUTE format('ALTER TABLE %I.fbs_kiz_archive ADD CONSTRAINT fbs_kiz_archive_print_state_check CHECK (print_state IN (''available'',''reserved'',''printed''))', org.data_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS fbs_kiz_archive_available_idx ON %I.fbs_kiz_archive (nm_id,barcode,archive_id) WHERE print_state=''available''', org.data_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS fbs_kiz_archive_print_job_idx ON %I.fbs_kiz_archive (print_job_id,print_position)', org.data_schema);

    EXECUTE format('ALTER TABLE %I.fbs_kiz_archive_events DROP CONSTRAINT IF EXISTS fbs_kiz_archive_events_event_type_check', org.data_schema);
    EXECUTE format('ALTER TABLE %I.fbs_kiz_archive_events ADD CONSTRAINT fbs_kiz_archive_events_event_type_check CHECK (event_type IN (''added'',''duplicate'',''error'',''checked'',''print_reserved'',''printed'',''print_recovered''))', org.data_schema);
  END LOOP;
END
$upgrade$;

COMMIT;
