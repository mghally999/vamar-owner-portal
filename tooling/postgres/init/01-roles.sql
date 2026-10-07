-- Runs once when the local Postgres volume is created.
-- Mirrors the two roles we use on Neon:
--   vamar       owner of the schema, used by migrations and the seed script
--   vamar_app   runtime role used by the API; gets INSERT/SELECT only on audit_log
--               (the grants themselves live in the migrations so they apply on Neon too)
CREATE ROLE vamar_app LOGIN PASSWORD 'vamar_app';
GRANT CONNECT ON DATABASE vamar TO vamar_app;

-- Separate database for API integration tests so they can truncate freely.
CREATE DATABASE vamar_test OWNER vamar;
GRANT CONNECT ON DATABASE vamar_test TO vamar_app;
