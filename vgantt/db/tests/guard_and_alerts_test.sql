-- =============================================================================
-- guard_and_alerts_test.sql
-- Runs as a superuser (needs DDL). Verifies:
--   * the "no credentials in PostgreSQL" guard actually rejects DDL
--   * the 30/15/7/3 warning ladder fires on exactly the right days
--   * the engine is idempotent (re-running does not spam the inbox)
-- =============================================================================
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

CREATE OR REPLACE FUNCTION pg_temp.assert(p_condition boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_condition THEN RAISE NOTICE '  PASS  %', p_label;
    ELSE RAISE EXCEPTION 'FAIL  %', p_label; END IF;
END $$;

\echo '== A. Vault policy: the database refuses credential columns ==='
DO $$
BEGIN
    CREATE TABLE app.sifre_kasasi (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        site text,
        username text,
        password text            -- <- exactly what module C must never allow
    );
    RAISE EXCEPTION 'FAIL  a table with a password column was created';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE '  PASS  CREATE TABLE with a password column rejected';
END $$;

DO $$
BEGIN
    ALTER TABLE app.licenses ADD COLUMN api_key text;
    RAISE EXCEPTION 'FAIL  an api_key column was added';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE '  PASS  ALTER TABLE ADD api_key rejected';
END $$;

-- Booleans and timestamps that merely mention the word are fine.
CREATE TEMP TABLE guard_probe_ok (id int);
ALTER TABLE app.licenses ADD COLUMN password_rotation_required boolean DEFAULT false;
SELECT pg_temp.assert(true, 'boolean flag containing "password" is allowed');
ALTER TABLE app.licenses DROP COLUMN password_rotation_required;

-- The allow-listed one-way hashes stay legal.
SELECT pg_temp.assert(
    (SELECT count(*) FROM platform.check_no_secret_columns()) = 0,
    'check_no_secret_columns() reports a clean database');

SELECT pg_temp.assert(
    (SELECT count(*) FROM information_schema.columns
     WHERE table_schema IN ('app','platform','audit')
       AND column_name IN ('password','passwd','secret','api_key','private_key')) = 0,
    'no credential-shaped column exists anywhere in the schema');

SELECT pg_temp.assert(
    (SELECT stores_server_data FROM platform.modules WHERE key = 'vault') = false,
    'the vault module is flagged as client-side-only in the catalogue');

\echo '== B. The 30 / 15 / 7 / 3 ladder =============================='
-- A licence expiring in exactly 30 days, in a dedicated tenant.
INSERT INTO platform.tenants (id, slug, name, status)
VALUES ('0c000000-0000-4000-8000-0000000000ff', 'ladder-test', 'Ladder Test A.Ş.', 'active')
ON CONFLICT DO NOTHING;
INSERT INTO platform.tenant_modules (tenant_id, module_key, is_enabled)
VALUES ('0c000000-0000-4000-8000-0000000000ff', 'licenses', true)
ON CONFLICT DO NOTHING;
INSERT INTO app.licenses (id, tenant_id, name, license_type, end_date)
VALUES ('0c000000-0000-4000-8000-0000000000fe', '0c000000-0000-4000-8000-0000000000ff',
        'ladder.test domain', 'domain', current_date + 30)
ON CONFLICT DO NOTHING;

-- Walk a virtual clock from 40 days out down to the due date and record which
-- days produced a notification.
DO $$
DECLARE
    d       integer;
    as_of   date;
    fired   integer[] := '{}';
BEGIN
    FOR d IN REVERSE 40..0 LOOP
        as_of := (current_date + 30) - d;
        PERFORM app.generate_license_alerts(as_of);
    END LOOP;

    SELECT array_agg(threshold_days ORDER BY threshold_days DESC)
    INTO fired
    FROM app.notifications
    WHERE source_id = '0c000000-0000-4000-8000-0000000000fe';

    IF fired = ARRAY[30, 15, 7, 3, 0] THEN
        RAISE NOTICE '  PASS  ladder fired on days %, and nothing else', fired;
    ELSE
        RAISE EXCEPTION 'FAIL  expected {30,15,7,3,0}, got %', fired;
    END IF;
END $$;

SELECT pg_temp.assert(
    (SELECT severity FROM app.notifications
      WHERE source_id = '0c000000-0000-4000-8000-0000000000fe' AND threshold_days = 30) = 'info',
    'the 30-day warning is informational');
SELECT pg_temp.assert(
    (SELECT severity FROM app.notifications
      WHERE source_id = '0c000000-0000-4000-8000-0000000000fe' AND threshold_days = 7) = 'warning',
    'the 7-day warning escalates to warning');
SELECT pg_temp.assert(
    (SELECT severity FROM app.notifications
      WHERE source_id = '0c000000-0000-4000-8000-0000000000fe' AND threshold_days = 3) = 'critical',
    'the 3-day warning escalates to critical');

\echo '== C. Idempotency ============================================='
DO $$
DECLARE
    before_count integer;
    after_count  integer;
BEGIN
    SELECT count(*) INTO before_count FROM app.notifications;
    PERFORM platform.run_alert_engine();
    PERFORM platform.run_alert_engine();
    PERFORM platform.run_alert_engine();
    SELECT count(*) INTO after_count FROM app.notifications;

    IF before_count = after_count THEN
        RAISE NOTICE '  PASS  three extra engine runs created 0 duplicate notifications';
    ELSE
        RAISE EXCEPTION 'FAIL  engine is not idempotent (% -> %)', before_count, after_count;
    END IF;
END $$;

-- Renewing must open a fresh ladder, because the dedupe key carries the due date.
DO $$
DECLARE
    v_new integer;
BEGIN
    UPDATE app.licenses SET end_date = current_date + 3
    WHERE id = '0c000000-0000-4000-8000-0000000000fe';

    PERFORM app.generate_license_alerts(current_date);

    SELECT count(*) INTO v_new FROM app.notifications
    WHERE source_id = '0c000000-0000-4000-8000-0000000000fe'
      AND due_date = current_date + 3;

    IF v_new = 1 THEN
        RAISE NOTICE '  PASS  a new due date starts a new warning ladder';
    ELSE
        RAISE EXCEPTION 'FAIL  expected 1 notification for the new due date, got %', v_new;
    END IF;
END $$;

\echo '== D. Receivables: 3-day reminder + overdue escalation ========'
SELECT pg_temp.assert(
    EXISTS (SELECT 1 FROM app.notifications
            WHERE category = 'finance.receivable' AND threshold_days = 3),
    'a reminder exists 3 days before the due date');
SELECT pg_temp.assert(
    EXISTS (SELECT 1 FROM app.notifications
            WHERE category = 'finance.receivable' AND threshold_days < 0),
    'overdue receivables escalate after the due date');
SELECT pg_temp.assert(
    (SELECT risk_bucket FROM app.v_receivables WHERE invoice_no = 'FTR-2026-0141') = 'overdue',
    'a 15-day-late invoice lands in the overdue (red) bucket');
SELECT pg_temp.assert(
    (SELECT risk_bucket FROM app.v_receivables WHERE invoice_no = 'FTR-2026-0152') = 'due_soon',
    'an invoice due in 3 days lands in due_soon');
SELECT pg_temp.assert(
    (SELECT status FROM app.customer_invoices WHERE invoice_no = 'FTR-2026-0133') = 'overdue'
    AND (SELECT paid_amount FROM app.customer_invoices WHERE invoice_no = 'FTR-2026-0133') = 100000.00,
    'partial payment is reflected in paid_amount and status');

\echo '== E. Subscription alerts reach VganttAdmin ==================='
SELECT pg_temp.assert(
    (SELECT count(*) FROM platform.admin_notifications WHERE category = 'subscription.expiry') >= 3,
    'the operator inbox has one subscription warning per expiring tenant');
SELECT pg_temp.assert(
    (SELECT expiry_bucket FROM platform.v_tenant_overview WHERE slug = 'gamma-lojistik') = 'critical',
    'a tenant 3 days from expiry shows as critical in the admin overview');
SELECT pg_temp.assert(
    (SELECT expiry_bucket FROM platform.v_tenant_overview WHERE slug = 'acme-insaat') = 'urgent',
    'a tenant 7 days from expiry shows as urgent');

-- cleanup
DELETE FROM platform.tenants WHERE slug = 'ladder-test';

\echo ''
\echo 'ALL GUARD + ALERT TESTS PASSED'
