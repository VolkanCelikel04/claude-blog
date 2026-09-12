-- =============================================================================
-- 0010_grants.sql
-- Final privilege surface. Run last: it also transfers ownership of everything
-- created by the migrations to vgantt_migrator.
--
-- Why ownership matters here: the SECURITY DEFINER helpers (tenant_has_module,
-- emit_notification, the alert generators) must be able to look across tenants.
-- They inherit their owner's rights, so the owner is vgantt_migrator - a
-- NOLOGIN, BYPASSRLS role that nothing can connect as.
-- =============================================================================
\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- Transfer ownership of tables, views, sequences, types and functions
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT n.nspname, c.relname, c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('app', 'platform', 'audit')
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
          AND c.relowner <> 'vgantt_migrator'::regrole
          -- identity / serial sequences follow their table's owner automatically
          AND NOT EXISTS (
                SELECT 1 FROM pg_depend d
                WHERE d.classid = 'pg_class'::regclass
                  AND d.objid = c.oid
                  AND d.deptype IN ('a', 'i'))
    LOOP
        EXECUTE format('ALTER %s %I.%I OWNER TO vgantt_migrator',
            CASE r.relkind
                WHEN 'S' THEN 'SEQUENCE'
                WHEN 'v' THEN 'VIEW'
                WHEN 'm' THEN 'MATERIALIZED VIEW'
                ELSE 'TABLE'
            END, r.nspname, r.relname);
    END LOOP;

    FOR r IN
        SELECT n.nspname, p.oid::regprocedure AS sig, p.prokind
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('app', 'platform', 'audit')
          AND p.proowner <> 'vgantt_migrator'::regrole
    LOOP
        EXECUTE format('ALTER %s %s OWNER TO vgantt_migrator',
            CASE r.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, r.sig);
    END LOOP;

    FOR r IN
        SELECT n.nspname, t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname IN ('app', 'platform')
          AND t.typtype = 'e'
          AND t.typowner <> 'vgantt_migrator'::regrole
    LOOP
        EXECUTE format('ALTER TYPE %I.%I OWNER TO vgantt_migrator', r.nspname, r.typname);
    END LOOP;
END
$$;

ALTER SCHEMA app      OWNER TO vgantt_migrator;
ALTER SCHEMA platform OWNER TO vgantt_migrator;
ALTER SCHEMA audit    OWNER TO vgantt_migrator;

-- -----------------------------------------------------------------------------
-- Platform control-plane role: full access, RLS bypassed by role attribute.
-- -----------------------------------------------------------------------------
GRANT ALL ON ALL TABLES    IN SCHEMA platform, app, audit TO vgantt_platform_api;
GRANT ALL ON ALL SEQUENCES IN SCHEMA platform, app, audit TO vgantt_platform_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA platform, app     TO vgantt_platform_api;

-- -----------------------------------------------------------------------------
-- Tenant API role
--
-- Per-table DML grants were issued by app.apply_tenant_rls(). What is left is
-- the read-only window onto the control plane that the tenant UI needs.
-- -----------------------------------------------------------------------------
GRANT SELECT ON
    platform.tenants,
    platform.tenant_contacts,
    platform.subscriptions,
    platform.tenant_modules,
    platform.modules,
    platform.plans,
    platform.plan_modules,
    platform.invoices,
    platform.payments,
    platform.alert_policies,
    platform.alert_sources
TO vgantt_api;

GRANT SELECT, INSERT ON audit.activity_log TO vgantt_api;
GRANT USAGE, SELECT ON SEQUENCE audit.activity_log_id_seq TO vgantt_api;

-- -----------------------------------------------------------------------------
-- Function privileges
--
-- PostgreSQL grants EXECUTE on every new function to PUBLIC. For ordinary
-- functions that is harmless; for the SECURITY DEFINER helpers here it is not -
-- app.emit_notification() takes a tenant_id argument and runs as the owner, so
-- a PUBLIC grant would let any tenant write into any other tenant's inbox.
--
-- So: revoke the default wholesale, then hand back the short list the tenant
-- role genuinely needs. Everything else (the alert generators, the maintenance
-- routines, the bulk occurrence generator) stays reachable only from the
-- platform pool.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    fn record;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('app', 'platform', 'audit')
          AND p.prokind = 'f'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.sig);
    END LOOP;
END
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA platform, app TO vgantt_platform_api;

-- The complete list of functions tenant traffic may call.
GRANT EXECUTE ON FUNCTION
    app.set_tenant_context(uuid, uuid),
    app.current_tenant_id(),
    app.current_user_id(),
    app.tenant_has_module(uuid, text),
    app.severity_for_days(integer),
    app.generate_my_expense_occurrences(integer),
    platform.thresholds_for(uuid, text),
    platform.check_no_secret_columns()
TO vgantt_api;

-- Tenant traffic may never widen its own view of the world.
REVOKE INSERT, UPDATE, DELETE ON
    platform.tenants, platform.tenant_contacts, platform.subscriptions,
    platform.tenant_modules, platform.modules, platform.plans, platform.plan_modules,
    platform.invoices, platform.payments, platform.alert_sources, platform.alert_policies
FROM vgantt_api;

-- -----------------------------------------------------------------------------
-- Future objects created by vgantt_migrator inherit the same defaults, so a new
-- module migration cannot silently ship an ungranted (or over-granted) table.
-- -----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE vgantt_migrator IN SCHEMA app, platform, audit
    GRANT ALL ON TABLES TO vgantt_platform_api;
ALTER DEFAULT PRIVILEGES FOR ROLE vgantt_migrator IN SCHEMA app, platform, audit
    GRANT ALL ON SEQUENCES TO vgantt_platform_api;
ALTER DEFAULT PRIVILEGES FOR ROLE vgantt_migrator IN SCHEMA app, platform
    GRANT EXECUTE ON FUNCTIONS TO vgantt_platform_api;
-- Without this, every function a future module adds would again be EXECUTE-able
-- by PUBLIC, quietly re-opening the hole this migration closes.
ALTER DEFAULT PRIVILEGES FOR ROLE vgantt_migrator IN SCHEMA app, platform, audit
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

INSERT INTO platform.schema_migrations(version) VALUES ('0010_grants')
ON CONFLICT DO NOTHING;
