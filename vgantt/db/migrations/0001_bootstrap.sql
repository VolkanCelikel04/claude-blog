-- =============================================================================
-- 0001_bootstrap.sql
-- Extensions, schemas, database roles, tenant-context primitives, RLS helpers.
--
-- Run as a superuser (or a role with CREATEROLE + CREATE on the database).
-- Every later migration assumes the objects created here exist.
-- =============================================================================

\set ON_ERROR_STOP on
\set app_password `echo "${VGANTT_DB_APP_PASSWORD:-vgantt_app_dev_pw}"`
\set platform_password `echo "${VGANTT_DB_PLATFORM_PASSWORD:-vgantt_platform_dev_pw}"`

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive e-mail / slug
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusion constraints on daterange
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid() on PG < 13, digest()

-- -----------------------------------------------------------------------------
-- Schemas
--   platform : VganttAdmin territory (tenants, subscriptions, licensing, billing)
--   app      : tenant-owned business data (RLS enforced, every table has tenant_id)
--   audit    : append-only trail
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS audit;

COMMENT ON SCHEMA platform IS 'VganttAdmin control plane: tenants, subscriptions, module licensing, billing.';
COMMENT ON SCHEMA app      IS 'Tenant business data. Every table carries tenant_id and is protected by RLS.';
COMMENT ON SCHEMA audit    IS 'Append-only audit trail. Never updated or deleted by the application role.';

-- -----------------------------------------------------------------------------
-- Database roles
--
--   vgantt_migrator     : owns every object, runs migrations.  NOLOGIN group.
--   vgantt_api          : the ONLY role the tenant-facing API connects with.
--                         NOT superuser, NOT BYPASSRLS -> row level security
--                         is always in force for tenant traffic.
--   vgantt_platform_api : role used by the VganttAdmin control plane. Has
--                         BYPASSRLS so it can read across tenants. The backend
--                         keeps this on a SEPARATE connection pool that is only
--                         reachable from platform-admin routes.
--
-- Splitting the two pools is deliberate: a tenant-side SQL injection cannot
-- escalate to cross-tenant reads by flipping a session GUC, because the tenant
-- pool's role simply has no way to bypass RLS.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vgantt_migrator') THEN
        CREATE ROLE vgantt_migrator NOLOGIN BYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vgantt_api') THEN
        CREATE ROLE vgantt_api LOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vgantt_platform_api') THEN
        CREATE ROLE vgantt_platform_api LOGIN BYPASSRLS;
    END IF;
END
$$;

ALTER ROLE vgantt_api          WITH PASSWORD :'app_password';
ALTER ROLE vgantt_platform_api WITH PASSWORD :'platform_password' BYPASSRLS;

-- Neither API role may create objects anywhere.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA platform, app, audit FROM PUBLIC;

GRANT USAGE ON SCHEMA platform, app, audit TO vgantt_api, vgantt_platform_api;

-- -----------------------------------------------------------------------------
-- Request context
--
-- The API opens a transaction, calls app.set_tenant_context(...) and only then
-- touches tenant tables. The GUCs are LOCAL, so they die with the transaction
-- and can never leak into the next request served by the same pooled connection.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT nullif(current_setting('vgantt.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT nullif(current_setting('vgantt.user_id', true), '')::uuid
$$;

COMMENT ON FUNCTION app.current_tenant_id() IS
'Tenant of the current transaction. NULL when unset -> every RLS predicate
evaluates to NULL -> zero rows. Fail-closed by construction.';

-- set_tenant_context is SECURITY DEFINER so it can validate the tenant against
-- platform.tenants (which vgantt_api can only read through RLS) before binding.
CREATE OR REPLACE FUNCTION app.set_tenant_context(p_tenant_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app
AS $$
BEGIN
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id is required' USING ERRCODE = '22004';
    END IF;

    PERFORM set_config('vgantt.tenant_id', p_tenant_id::text, true);  -- true = LOCAL
    PERFORM set_config('vgantt.user_id', coalesce(p_user_id::text, ''), true);
END
$$;

REVOKE ALL ON FUNCTION app.set_tenant_context(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_tenant_context(uuid, uuid) TO vgantt_api, vgantt_platform_api;

-- -----------------------------------------------------------------------------
-- Module licensing lookup: app.tenant_has_module(tenant, module_key)
--
-- Defined in 0003, right after platform.tenant_modules exists. It is referenced
-- from the policy text generated by app.apply_tenant_rls() below, which is
-- evaluated lazily, so the ordering is safe.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Shared trigger helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END
$$;

-- Stamps tenant_id from the session context on INSERT so application code can
-- never "forget" it, and rejects any attempt to write into another tenant.
CREATE OR REPLACE FUNCTION app.enforce_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    ctx uuid := app.current_tenant_id();
BEGIN
    IF ctx IS NULL THEN
        -- Platform pool (BYPASSRLS) writes must be explicit about the tenant.
        IF NEW.tenant_id IS NULL THEN
            RAISE EXCEPTION 'tenant_id missing and no tenant context is bound'
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.tenant_id IS NULL THEN
        NEW.tenant_id := ctx;
    ELSIF NEW.tenant_id <> ctx THEN
        RAISE EXCEPTION 'cross-tenant write blocked (context=%, payload=%)', ctx, NEW.tenant_id
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END
$$;

-- -----------------------------------------------------------------------------
-- app.apply_tenant_rls(table, module_key)
--
-- One call wires a table into the isolation model:
--   * ENABLE + FORCE row level security (FORCE also binds the table owner)
--   * tenant_isolation policy  : tenant_id must equal the bound context
--   * module gate (optional)   : rows disappear when VganttAdmin disables the
--                                module for that tenant
--   * updated_at + tenant_id triggers
--   * grants for the tenant API role
--
-- Every new module table goes through this function - see docs/ADDING-A-MODULE.md.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.apply_tenant_rls(p_table regclass, p_module_key text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_predicate text;
    v_ident     text := p_table::text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = p_table AND attname = 'tenant_id' AND NOT attisdropped
    ) THEN
        RAISE EXCEPTION '% has no tenant_id column; it cannot join the tenant RLS model', v_ident;
    END IF;

    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_ident);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', v_ident);

    v_predicate := 'tenant_id = app.current_tenant_id()';
    IF p_module_key IS NOT NULL THEN
        v_predicate := v_predicate
            || format(' AND app.tenant_has_module(tenant_id, %L)', p_module_key);
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', v_ident);
    EXECUTE format(
        'CREATE POLICY tenant_isolation ON %s FOR ALL TO vgantt_api USING (%s) WITH CHECK (%s)',
        v_ident, v_predicate, v_predicate);

    EXECUTE format(
        'CREATE OR REPLACE TRIGGER trg_%s_tenant_id BEFORE INSERT OR UPDATE ON %s
         FOR EACH ROW EXECUTE FUNCTION app.enforce_tenant_id()',
        replace(replace(v_ident, '.', '_'), '"', ''), v_ident);

    IF EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = p_table AND attname = 'updated_at' AND NOT attisdropped
    ) THEN
        EXECUTE format(
            'CREATE OR REPLACE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s
             FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()',
            replace(replace(v_ident, '.', '_'), '"', ''), v_ident);
    END IF;

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO vgantt_api', v_ident);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO vgantt_platform_api', v_ident);
END
$$;

-- -----------------------------------------------------------------------------
-- Schema version bookkeeping
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.schema_migrations (
    version     text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    checksum    text
);

INSERT INTO platform.schema_migrations(version) VALUES ('0001_bootstrap')
ON CONFLICT DO NOTHING;
