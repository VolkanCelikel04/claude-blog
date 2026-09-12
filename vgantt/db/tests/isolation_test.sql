-- =============================================================================
-- isolation_test.sql
-- Runs as vgantt_api (the tenant pool role, no BYPASSRLS).
--
-- Every assertion below is what an attacker would try. A failure raises and the
-- script exits non-zero, so this is CI-gradeable.
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

\set acme   '0c000000-0000-4000-8000-000000000001'
\set beta   '0c000000-0000-4000-8000-000000000002'
\set gamma  '0c000000-0000-4000-8000-000000000003'

CREATE OR REPLACE FUNCTION pg_temp.assert(p_condition boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_condition THEN
        RAISE NOTICE '  PASS  %', p_label;
    ELSE
        RAISE EXCEPTION 'FAIL  %', p_label;
    END IF;
END $$;

\echo '== 1. No tenant context bound =================================='
BEGIN;
    SELECT pg_temp.assert((SELECT count(*) FROM app.licenses) = 0,
        'unbound session sees zero licences (fail-closed)');
    SELECT pg_temp.assert((SELECT count(*) FROM app.customer_invoices) = 0,
        'unbound session sees zero invoices');
    SELECT pg_temp.assert((SELECT count(*) FROM app.users) = 0,
        'unbound session sees zero users');
COMMIT;

\echo '== 2. Bound to Acme ==========================================='
BEGIN;
    SELECT app.set_tenant_context(:'acme');

    SELECT pg_temp.assert((SELECT count(*) FROM app.licenses) = 6,
        'Acme sees exactly its own 6 licences');
    SELECT pg_temp.assert(
        (SELECT count(DISTINCT tenant_id) FROM app.licenses) = 1,
        'no foreign tenant_id leaks into the result set');
    SELECT pg_temp.assert(
        (SELECT count(*) FROM app.licenses WHERE tenant_id <> :'acme'::uuid) = 0,
        'explicit filter for another tenant returns nothing');
    SELECT pg_temp.assert((SELECT count(*) FROM platform.tenants) = 1,
        'Acme sees only its own tenant row');
COMMIT;

\echo '== 3. Cross-tenant write attempts ============================='
BEGIN;
    SELECT app.set_tenant_context(:'acme');

    -- Forge a row for Beta while bound to Acme.
    DO $$
    BEGIN
        INSERT INTO app.licenses (tenant_id, name, license_type, end_date)
        VALUES ('0c000000-0000-4000-8000-000000000002', 'sizinti.com', 'domain', current_date + 90);
        RAISE EXCEPTION 'FAIL  cross-tenant INSERT was allowed';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE '  PASS  cross-tenant INSERT blocked (%)', 'trigger';
        WHEN check_violation OR raise_exception THEN
            IF sqlerrm LIKE 'FAIL%' THEN RAISE; END IF;
            RAISE NOTICE '  PASS  cross-tenant INSERT blocked';
    END $$;

    -- Try to move one of Acme's own rows into Beta.
    DO $$
    BEGIN
        UPDATE app.licenses SET tenant_id = '0c000000-0000-4000-8000-000000000002';
        RAISE EXCEPTION 'FAIL  cross-tenant UPDATE was allowed';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE '  PASS  tenant_id reassignment blocked';
        WHEN raise_exception THEN
            IF sqlerrm LIKE 'FAIL%' THEN RAISE; END IF;
            RAISE NOTICE '  PASS  tenant_id reassignment blocked';
    END $$;

    -- Deleting another tenant's data is a no-op, not an error.
    WITH d AS (DELETE FROM app.licenses WHERE tenant_id = '0c000000-0000-4000-8000-000000000002' RETURNING 1)
    SELECT pg_temp.assert((SELECT count(*) FROM d) = 0, 'DELETE on another tenant affects 0 rows');
ROLLBACK;

\echo '== 4. tenant_id is stamped automatically ======================'
BEGIN;
    SELECT app.set_tenant_context(:'acme');
    INSERT INTO app.licenses (name, license_type, end_date)
    VALUES ('otomatik-damga.test', 'software', current_date + 120);
    SELECT pg_temp.assert(
        (SELECT tenant_id FROM app.licenses WHERE name = 'otomatik-damga.test') = :'acme'::uuid,
        'omitted tenant_id is filled from the session context');
ROLLBACK;

\echo '== 5. Module licensing gate ==================================='
BEGIN;
    -- Gamma has the finance module switched OFF in platform.tenant_modules.
    SELECT app.set_tenant_context(:'gamma');
    SELECT pg_temp.assert((SELECT count(*) FROM app.licenses) = 1,
        'Gamma sees its licence rows (licenses module is ON)');
    SELECT pg_temp.assert((SELECT count(*) FROM app.customer_invoices) = 0,
        'Gamma sees no finance rows (finance module is OFF)');
    SELECT pg_temp.assert(app.tenant_has_module(:'gamma', 'finance') = false,
        'tenant_has_module reports finance disabled');
    SELECT pg_temp.assert(app.tenant_has_module(:'gamma', 'licenses') = true,
        'tenant_has_module reports licenses enabled');

    -- A disabled module must also reject writes, not just hide reads.
    DO $$
    BEGIN
        INSERT INTO app.customers (name) VALUES ('Lisanssız modüle yazma denemesi');
        RAISE EXCEPTION 'FAIL  write into a disabled module was allowed';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE '  PASS  write into a disabled module blocked by RLS';
        WHEN raise_exception THEN
            IF sqlerrm LIKE 'FAIL%' THEN RAISE; END IF;
            RAISE NOTICE '  PASS  write into a disabled module blocked';
    END $$;
ROLLBACK;

\echo '== 6. Control-plane tables are out of reach ==================='
BEGIN;
    SELECT app.set_tenant_context(:'acme');
    DO $$
    BEGIN
        PERFORM 1 FROM platform.admin_users;
        RAISE EXCEPTION 'FAIL  tenant role could read platform.admin_users';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE '  PASS  platform.admin_users is not readable by the tenant role';
    END $$;

    DO $$
    BEGIN
        UPDATE platform.tenant_modules SET is_enabled = true
        WHERE tenant_id = '0c000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'FAIL  tenant role could switch its own module on';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE '  PASS  tenant cannot self-license a module';
    END $$;
ROLLBACK;

\echo '== 6b. Privileged functions are out of reach =================='
BEGIN;
    SELECT app.set_tenant_context(:'acme');

    -- SECURITY DEFINER helpers take a tenant_id argument and run as the owner.
    -- If PUBLIC kept its default EXECUTE grant, this call would let Acme write
    -- into Beta's notification inbox.
    DO $$
    BEGIN
        PERFORM app.emit_notification(
            '0c000000-0000-4000-8000-000000000002'::uuid, 'sahte', NULL,
            'Baska tenant icin uydurma bildirim', NULL, 'spoof', 'x', 3, current_date, NULL);
        RAISE EXCEPTION 'FAIL  tenant role could forge a notification for another tenant';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE '  PASS  app.emit_notification is not callable by the tenant role';
    END $$;

    DO $$
    BEGIN
        PERFORM platform.run_alert_engine();
        RAISE EXCEPTION 'FAIL  tenant role could run the alert engine';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE '  PASS  platform.run_alert_engine is not callable by the tenant role';
    END $$;

    DO $$
    BEGIN
        PERFORM app.generate_expense_occurrences(90);
        RAISE EXCEPTION 'FAIL  tenant role could run the cross-tenant generator';
    EXCEPTION
        WHEN insufficient_privilege THEN
            RAISE NOTICE '  PASS  the cross-tenant occurrence generator is out of reach';
    END $$;

    -- ...but the tenant-scoped wrapper is allowed, and only touches its own rows.
    SELECT pg_temp.assert(
        app.generate_my_expense_occurrences(90) >= 0,
        'the tenant-scoped occurrence generator IS callable');

    SELECT pg_temp.assert(
        (SELECT count(*) FROM app.expense_occurrences
          WHERE tenant_id <> :'acme'::uuid) = 0,
        'the scoped generator created nothing for other tenants');
ROLLBACK;

\echo '== 7. Context does not survive the transaction ================'
BEGIN;
    SELECT app.set_tenant_context(:'acme');
COMMIT;
SELECT pg_temp.assert(app.current_tenant_id() IS NULL,
    'SET LOCAL context is gone after COMMIT (safe for pooled connections)');
SELECT pg_temp.assert((SELECT count(*) FROM app.licenses) = 0,
    'next request on the same connection starts unbound');

\echo '== 8. Views respect the caller, not their owner ==============='
BEGIN;
    SELECT app.set_tenant_context(:'beta');
    SELECT pg_temp.assert((SELECT count(*) FROM app.v_license_expiry) = 2,
        'v_license_expiry is filtered for Beta (security_invoker)');
    SELECT pg_temp.assert(
        (SELECT count(*) FROM app.v_receivables) = 0,
        'Beta has no receivables of its own');
COMMIT;

\echo '== 9. Notifications are tenant-scoped ========================='
BEGIN;
    SELECT app.set_tenant_context(:'acme');
    SELECT pg_temp.assert((SELECT count(*) FROM app.notifications) > 0,
        'Acme received expiry notifications');
    SELECT pg_temp.assert(
        (SELECT count(DISTINCT tenant_id) FROM app.notifications) = 1,
        'notification inbox never mixes tenants');
COMMIT;

\echo ''
\echo 'ALL ISOLATION TESTS PASSED'
