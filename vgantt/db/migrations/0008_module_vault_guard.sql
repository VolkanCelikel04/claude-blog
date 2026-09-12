-- =============================================================================
-- 0008_module_vault_guard.sql   ---  MODULE C: Local password vault
--
-- This migration creates NO table for the vault, on purpose.
--
-- Module C data (usernames, passwords, notes) lives exclusively in an .xlsx
-- file under C:/Rsdw on the operator's own machine. Nothing is transmitted to
-- the API and nothing is persisted here.
--
-- What this file DOES create is the enforcement: an event trigger that rejects
-- any future migration trying to add a credential-shaped column to this
-- database. The rule stops being a convention someone can forget and becomes a
-- constraint the server applies to every CREATE/ALTER TABLE.
-- =============================================================================
\set ON_ERROR_STOP on

-- 1 ---------------------------------------------------------------- catalogue
INSERT INTO platform.modules
    (key, name, description, category, icon, sort_order, requires_desktop, stores_server_data)
VALUES
    ('vault', 'Yerel Şifre Kasası',
     'Kullanıcı adları ve şifreler yalnızca kullanıcının kendi bilgisayarında, C:/Rsdw altındaki şifreli Excel dosyasında saklanır. Sunucuya hiçbir veri gönderilmez.',
     'security', 'lock', 30, true, false)
ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        requires_desktop = EXCLUDED.requires_desktop,
        stores_server_data = EXCLUDED.stores_server_data;

-- 2 -------------------------------------------------------------- permissions
-- Only "may the menu item appear / may this workstation open a vault file".
-- There is no read/write permission, because the server never sees the data.
INSERT INTO app.permissions (key, module_key, description) VALUES
    ('vault.use',    'vault', 'Yerel şifre kasasını açma ve kullanma'),
    ('vault.export', 'vault', 'Kasa dosyasını dışa aktarma / yedekleme')
ON CONFLICT (key) DO NOTHING;

-- 3 ------------------------------------------------ the "no secrets" guardrail
CREATE TABLE platform.secret_column_allowlist (
    schema_name text NOT NULL,
    table_name  text NOT NULL,
    column_name text NOT NULL,
    reason      text NOT NULL,
    approved_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (schema_name, table_name, column_name)
);

COMMENT ON TABLE platform.secret_column_allowlist IS
'Explicit, reviewed exceptions to the credential-column ban. Adding a row here
is a security decision: it must be a one-way hash, never recoverable material.';

INSERT INTO platform.secret_column_allowlist VALUES
    ('app',      'users',          'password_hash',
     'Argon2id one-way digest of the login password. Not recoverable.'),
    ('platform', 'admin_users',    'password_hash',
     'Argon2id one-way digest of the VganttAdmin login password. Not recoverable.'),
    ('app',      'refresh_tokens', 'token_hash',
     'SHA-256 digest of a rotating session token. Not recoverable.')
ON CONFLICT DO NOTHING;

-- Column names that may never appear in this database.
--
-- Two conditions must hold before a column is rejected:
--   1. the NAME looks like credential material, and
--   2. the TYPE could actually hold one (text / binary / json).
-- Booleans, timestamps and counters are exempt, so flags like
-- app.users.must_change_password or vault_workstations.last_backup_at pass.
CREATE OR REPLACE FUNCTION platform.is_forbidden_secret_name(p_column text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(p_column) ~ (
        '(^|_)(password|passwd|pwd|secret|credential|credentials|passphrase|'
        || 'apikey|api_key|private_key|access_key|client_secret|otp_seed|'
        || 'totp_secret|mfa_secret|vault_entry|vault_data|plaintext)($|_)'
    )
$$;

-- True when the type can carry a string/binary payload (directly or as an array).
CREATE OR REPLACE FUNCTION platform.type_can_hold_secret(p_typid oid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    WITH resolved AS (
        SELECT CASE WHEN t.typcategory = 'A' THEN t.typelem ELSE t.oid END AS oid
        FROM pg_type t WHERE t.oid = p_typid
    )
    SELECT coalesce(bool_or(t.typcategory = 'S' OR t.typname IN ('bytea','json','jsonb','xml')), false)
    FROM resolved r JOIN pg_type t ON t.oid = r.oid
$$;

CREATE OR REPLACE FUNCTION platform.is_forbidden_secret_column(p_column text, p_typid oid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
    SELECT platform.is_forbidden_secret_name(p_column)
       AND platform.type_can_hold_secret(p_typid)
$$;

CREATE OR REPLACE FUNCTION platform.guard_no_secret_columns()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
    obj      record;
    offender record;
BEGIN
    FOR obj IN
        SELECT * FROM pg_event_trigger_ddl_commands()
        WHERE command_tag IN ('CREATE TABLE', 'ALTER TABLE', 'CREATE TABLE AS')
          AND object_type IN ('table')
    LOOP
        FOR offender IN
            SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name
            FROM pg_attribute a
            JOIN pg_class     c ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.oid = obj.objid
              AND a.attnum > 0
              AND NOT a.attisdropped
              AND n.nspname IN ('app', 'platform', 'audit', 'public')
              AND platform.is_forbidden_secret_column(a.attname, a.atttypid)
              AND NOT EXISTS (
                    SELECT 1 FROM platform.secret_column_allowlist w
                    WHERE w.schema_name = n.nspname
                      AND w.table_name  = c.relname
                      AND w.column_name = a.attname)
        LOOP
            RAISE EXCEPTION
                'VAULT POLICY VIOLATION: column %.%.% looks like stored credential material',
                offender.schema_name, offender.table_name, offender.column_name
            USING
                ERRCODE = '42501',
                DETAIL  = 'Module C (yerel şifre kasası) forbids persisting credentials server-side.',
                HINT    = 'Keep the value in the local C:/Rsdw vault file, or - if it is a one-way '
                       || 'hash - record the exception in platform.secret_column_allowlist first.';
        END LOOP;
    END LOOP;
END
$$;

-- Event triggers need superuser. On managed PostgreSQL where that is not
-- available the guard degrades to a warning; CI still runs check_no_secret_columns().
DO $$
BEGIN
    DROP EVENT TRIGGER IF EXISTS vgantt_no_secret_columns;
    CREATE EVENT TRIGGER vgantt_no_secret_columns
        ON ddl_command_end
        WHEN TAG IN ('CREATE TABLE', 'ALTER TABLE', 'CREATE TABLE AS')
        EXECUTE FUNCTION platform.guard_no_secret_columns();
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE WARNING 'Could not install the vault DDL guard (needs superuser). '
                      'Run platform.check_no_secret_columns() in CI instead.';
END
$$;

-- Same rule, callable on demand: used by CI and by the API health check so the
-- invariant is verified even where the event trigger could not be installed.
CREATE OR REPLACE FUNCTION platform.check_no_secret_columns()
RETURNS TABLE (schema_name text, table_name text, column_name text)
LANGUAGE sql
STABLE
AS $$
    SELECT n.nspname::text, c.relname::text, a.attname::text
    FROM pg_attribute a
    JOIN pg_class     c ON c.oid = a.attrelid AND c.relkind IN ('r', 'p', 'f')
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE a.attnum > 0
      AND NOT a.attisdropped
      AND n.nspname IN ('app', 'platform', 'audit', 'public')
      AND platform.is_forbidden_secret_column(a.attname, a.atttypid)
      AND NOT EXISTS (
            SELECT 1 FROM platform.secret_column_allowlist w
            WHERE w.schema_name = n.nspname
              AND w.table_name  = c.relname
              AND w.column_name = a.attname)
$$;

COMMENT ON FUNCTION platform.check_no_secret_columns() IS
'Returns one row per policy violation. Empty result = the database holds no
credential-shaped columns outside the reviewed allowlist.';

-- 4 -------------------------------------------- non-secret vault bookkeeping
-- The only thing the server is allowed to know about module C: which
-- workstation has a vault configured, so support can answer "where is my file".
-- No entry data, no file contents, no key material.
CREATE TABLE app.vault_workstations (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    user_id        uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    device_label   text NOT NULL,                  -- "VOLKAN-PC"
    vault_path     text NOT NULL DEFAULT 'C:/Rsdw/vault.xlsx',
    entry_count    integer NOT NULL DEFAULT 0 CHECK (entry_count >= 0),
    last_opened_at timestamptz,
    last_backup_at timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT vault_workstations_unique UNIQUE (user_id, device_label)
);

COMMENT ON TABLE app.vault_workstations IS
'Operational metadata only: device label, file path, entry COUNT and timestamps.
Never an entry, a username, a password, a salt or a key. See docs/SECURITY-VAULT.md.';

SELECT app.apply_tenant_rls('app.vault_workstations', 'vault');

INSERT INTO platform.schema_migrations(version) VALUES ('0008_module_vault_guard')
ON CONFLICT DO NOTHING;
