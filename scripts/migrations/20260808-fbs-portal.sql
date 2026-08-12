\set ON_ERROR_STOP on

-- Separate warehouse portal identities. They are intentionally not stored in
-- public.users, so a warehouse credential can never authenticate in MpHub.
BEGIN;

CREATE TABLE IF NOT EXISTS public.fbs_portal_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_by BIGINT REFERENCES public.fbs_portal_users(id) ON DELETE SET NULL,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS fbs_portal_users_email_lower_idx
  ON public.fbs_portal_users (LOWER(email));

CREATE TABLE IF NOT EXISTS public.fbs_portal_permissions (
  user_id BIGINT NOT NULL REFERENCES public.fbs_portal_users(id) ON DELETE CASCADE,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  can_assembly BOOLEAN NOT NULL DEFAULT FALSE,
  can_stock BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS fbs_portal_permissions_org_idx
  ON public.fbs_portal_permissions (organization_id, user_id);

CREATE TABLE IF NOT EXISTS public.fbs_portal_login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  first_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.fbs_portal_audit (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES public.fbs_portal_users(id) ON DELETE SET NULL,
  target_user_id BIGINT REFERENCES public.fbs_portal_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS fbs_portal_audit_created_idx
  ON public.fbs_portal_audit (created_at DESC);

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mphub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      public.fbs_portal_users,
      public.fbs_portal_permissions,
      public.fbs_portal_login_attempts,
      public.fbs_portal_audit
    TO mphub_app;
    GRANT USAGE, SELECT ON SEQUENCE
      public.fbs_portal_users_id_seq,
      public.fbs_portal_audit_id_seq
    TO mphub_app;
  END IF;
END
$grants$;

COMMIT;
