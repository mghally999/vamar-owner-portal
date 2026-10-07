-- Runtime role used by the API. The role itself is created outside migrations
-- (tooling/postgres/init/01-roles.sql locally, Neon console in deployed environments)
-- because CREATE ROLE needs superuser-like rights that migrations should not have.
-- If the role does not exist yet (e.g. a fresh Neon branch), the grants are skipped and
-- must be re-applied with `pnpm db:migrate` after creating it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vamar_app') THEN
    GRANT USAGE ON SCHEMA public TO vamar_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vamar_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vamar_app;

    -- audit_log is append only for the application: it may write and read, never change or remove.
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM vamar_app;
    -- cheque_events is the cheque timeline: append only as well.
    REVOKE UPDATE, DELETE, TRUNCATE ON cheque_events FROM vamar_app;
  END IF;
END
$$;
