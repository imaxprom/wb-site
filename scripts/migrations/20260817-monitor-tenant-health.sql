\set ON_ERROR_STOP on

-- Monitoring capabilities are organization-scoped settings. The second legal
-- entity currently works only with FBS, so absence of FBO storage/remains and
-- warehouse measurements is expected and must not be reported as an outage.
BEGIN;

DO $monitor_capabilities$
DECLARE
  target_schema TEXT;
BEGIN
  SELECT data_schema INTO target_schema
  FROM public.organizations
  WHERE id = 2 AND status = 'active';

  IF target_schema IS NOT NULL THEN
    IF target_schema !~ '^organization_[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Invalid organization schema %', target_schema;
    END IF;
    EXECUTE format(
      'INSERT INTO %I.settings(key,value) VALUES (%L,%L) '
      'ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',
      target_schema,
      'monitor_fbo_enabled',
      'false'
    );
  END IF;
END
$monitor_capabilities$;

COMMIT;
