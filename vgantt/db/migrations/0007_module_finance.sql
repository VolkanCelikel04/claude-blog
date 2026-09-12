-- =============================================================================
-- 0007_module_finance.sql   ---  MODULE B: Finance / payment tracking
--
--   * recurring monthly expenses (with generated occurrences so "paid / unpaid"
--     is tracked per period rather than per template)
--   * customer invoices = receivables, with a payment ledger
--   * reporting views feeding the dashboard charts
--   * 3-day receivable reminder + overdue escalation
-- =============================================================================
\set ON_ERROR_STOP on

-- 1 ---------------------------------------------------------------- catalogue
INSERT INTO platform.modules (key, name, description, category, icon, sort_order, stores_server_data)
VALUES ('finance', 'Finans ve Ödeme Takibi',
        'Düzenli giderler, müşteri faturaları, vadesi gelen ve geciken alacakların takibi.',
        'finance', 'wallet', 20, true)
ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name, description = EXCLUDED.description;

-- 2 -------------------------------------------------------------- permissions
INSERT INTO app.permissions (key, module_key, description) VALUES
    ('finance.read',            'finance', 'Finansal verileri görüntüleme'),
    ('finance.expense.write',   'finance', 'Düzenli gider ekleme ve güncelleme'),
    ('finance.invoice.write',   'finance', 'Müşteri faturası ekleme ve güncelleme'),
    ('finance.payment.write',   'finance', 'Tahsilat ve ödeme kaydı girme'),
    ('finance.delete',          'finance', 'Finansal kayıt silme'),
    ('finance.report',          'finance', 'Finansal rapor ve özet görüntüleme')
ON CONFLICT (key) DO NOTHING;

-- 3 ------------------------------------------------------------------- types
CREATE TYPE app.expense_period    AS ENUM ('weekly', 'monthly', 'quarterly', 'yearly');
CREATE TYPE app.occurrence_status AS ENUM ('pending', 'paid', 'skipped', 'overdue');
CREATE TYPE app.receivable_status AS ENUM ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled');
CREATE TYPE app.category_kind     AS ENUM ('expense', 'income');

-- ------------------------------------------------------------------ categories
CREATE TABLE app.finance_categories (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    name       text NOT NULL,
    kind       app.category_kind NOT NULL DEFAULT 'expense',
    color      text CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
    is_active  boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT finance_categories_unique UNIQUE (tenant_id, name, kind)
);

-- ----------------------------------------------------- recurring expenses (A)
CREATE TABLE app.recurring_expenses (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    title          text NOT NULL CHECK (length(btrim(title)) > 0),
    category_id    uuid REFERENCES app.finance_categories(id) ON DELETE SET NULL,
    vendor         text,
    amount         numeric(12,2) NOT NULL CHECK (amount > 0),
    currency       char(3) NOT NULL DEFAULT 'TRY',
    period         app.expense_period NOT NULL DEFAULT 'monthly',
    day_of_month   smallint CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
    start_date     date NOT NULL DEFAULT current_date,
    end_date       date,
    payment_method text,
    is_active      boolean NOT NULL DEFAULT true,
    notes          text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recurring_expenses_period_valid CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX recurring_expenses_active_idx ON app.recurring_expenses (tenant_id)
    WHERE is_active;

-- One row per period instance: this is what makes "bu ay ödendi mi?" answerable.
CREATE TABLE app.expense_occurrences (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    recurring_expense_id uuid NOT NULL REFERENCES app.recurring_expenses(id) ON DELETE CASCADE,
    due_date             date NOT NULL,
    amount               numeric(12,2) NOT NULL CHECK (amount > 0),
    currency             char(3) NOT NULL DEFAULT 'TRY',
    status               app.occurrence_status NOT NULL DEFAULT 'pending',
    paid_on              date,
    paid_amount          numeric(12,2) CHECK (paid_amount IS NULL OR paid_amount >= 0),
    reference            text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT expense_occurrences_unique UNIQUE (recurring_expense_id, due_date),
    CONSTRAINT expense_occurrences_paid_consistent
        CHECK (status <> 'paid' OR (paid_on IS NOT NULL AND paid_amount IS NOT NULL))
);

CREATE INDEX expense_occurrences_due_idx ON app.expense_occurrences (tenant_id, due_date)
    WHERE status IN ('pending', 'overdue');

-- ----------------------------------------------------------- receivables (B)
CREATE TABLE app.customers (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    name       text NOT NULL CHECK (length(btrim(name)) > 0),
    email      citext,
    phone      text,
    tax_office text,
    tax_number text,
    address    text,
    is_active  boolean NOT NULL DEFAULT true,
    notes      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customers_unique_name UNIQUE (tenant_id, name)
);

CREATE TABLE app.customer_invoices (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    customer_id  uuid NOT NULL REFERENCES app.customers(id) ON DELETE RESTRICT,
    invoice_no   citext NOT NULL,
    description  text,
    issue_date   date NOT NULL DEFAULT current_date,
    due_date     date NOT NULL,                       -- vade tarihi
    amount       numeric(12,2) NOT NULL CHECK (amount > 0),
    tax_rate     numeric(5,2) NOT NULL DEFAULT 20.00 CHECK (tax_rate >= 0),
    total        numeric(12,2) GENERATED ALWAYS AS (round(amount * (1 + tax_rate / 100), 2)) STORED,
    currency     char(3) NOT NULL DEFAULT 'TRY',
    status       app.receivable_status NOT NULL DEFAULT 'sent',
    paid_amount  numeric(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    paid_at      timestamptz,                         -- ödeme tarihi
    created_by   uuid REFERENCES app.users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customer_invoices_no_unique UNIQUE (tenant_id, invoice_no),
    CONSTRAINT customer_invoices_due_after_issue CHECK (due_date >= issue_date)
);

CREATE INDEX customer_invoices_open_idx ON app.customer_invoices (tenant_id, due_date)
    WHERE status IN ('sent', 'partially_paid', 'overdue');
CREATE INDEX customer_invoices_customer_idx ON app.customer_invoices (customer_id, issue_date DESC);

CREATE TABLE app.customer_payments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    invoice_id  uuid NOT NULL REFERENCES app.customer_invoices(id) ON DELETE CASCADE,
    amount      numeric(12,2) NOT NULL CHECK (amount > 0),
    currency    char(3) NOT NULL DEFAULT 'TRY',
    paid_on     date NOT NULL DEFAULT current_date,
    method      platform.payment_method NOT NULL DEFAULT 'bank_transfer',
    reference   text,
    recorded_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_payments_invoice_idx ON app.customer_payments (invoice_id, paid_on DESC);

-- Single source of truth for invoice state: recomputed from the ledger.
CREATE OR REPLACE FUNCTION app.refresh_receivable_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_invoice_id uuid := coalesce(NEW.invoice_id, OLD.invoice_id);
    v_total numeric(12,2);
    v_paid  numeric(12,2);
    v_due   date;
BEGIN
    SELECT total, due_date INTO v_total, v_due
    FROM app.customer_invoices WHERE id = v_invoice_id;

    IF NOT FOUND THEN
        RETURN coalesce(NEW, OLD);
    END IF;

    SELECT coalesce(sum(amount), 0) INTO v_paid
    FROM app.customer_payments WHERE invoice_id = v_invoice_id;

    UPDATE app.customer_invoices SET
        paid_amount = v_paid,
        status = CASE
            WHEN v_paid >= v_total       THEN 'paid'::app.receivable_status
            WHEN v_paid > 0 AND v_due < current_date THEN 'overdue'::app.receivable_status
            WHEN v_paid > 0              THEN 'partially_paid'::app.receivable_status
            WHEN v_due < current_date    THEN 'overdue'::app.receivable_status
            ELSE 'sent'::app.receivable_status
        END,
        paid_at = CASE WHEN v_paid >= v_total THEN now() ELSE NULL END
    WHERE id = v_invoice_id
      AND status <> 'cancelled';

    RETURN coalesce(NEW, OLD);
END
$$;

CREATE OR REPLACE TRIGGER trg_customer_payments_refresh
    AFTER INSERT OR UPDATE OR DELETE ON app.customer_payments
    FOR EACH ROW EXECUTE FUNCTION app.refresh_receivable_status();

-- Nightly sweep: anything past its due date becomes 'overdue' without waiting
-- for someone to touch the row.
CREATE OR REPLACE FUNCTION app.mark_overdue_receivables()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
    WITH inv AS (
        UPDATE app.customer_invoices
        SET status = 'overdue'
        WHERE status IN ('sent', 'partially_paid')
          AND due_date < current_date
        RETURNING 1),
    occ AS (
        UPDATE app.expense_occurrences
        SET status = 'overdue'
        WHERE status = 'pending' AND due_date < current_date
        RETURNING 1)
    SELECT (SELECT count(*) FROM inv)::integer + (SELECT count(*) FROM occ)::integer
$$;

-- Materialise the next occurrences of every active recurring expense.
CREATE OR REPLACE FUNCTION app.generate_expense_occurrences(p_horizon_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
    r        record;
    v_cursor date;
    v_step   interval;
    v_count  integer := 0;
    v_limit  date := current_date + p_horizon_days;
BEGIN
    FOR r IN
        SELECT * FROM app.recurring_expenses
        WHERE is_active AND (end_date IS NULL OR end_date >= current_date)
    LOOP
        v_step := CASE r.period
            WHEN 'weekly'    THEN interval '1 week'
            WHEN 'monthly'   THEN interval '1 month'
            WHEN 'quarterly' THEN interval '3 months'
            WHEN 'yearly'    THEN interval '1 year'
        END;

        -- Start from the later of the template start date and today, then walk
        -- forward on the template's own cadence.
        v_cursor := greatest(r.start_date, current_date - interval '1 month')::date;
        IF r.period = 'monthly' AND r.day_of_month IS NOT NULL THEN
            v_cursor := make_date(
                extract(year from v_cursor)::int,
                extract(month from v_cursor)::int,
                least(r.day_of_month,
                      extract(day from (date_trunc('month', v_cursor) + interval '1 month - 1 day'))::int));
        END IF;

        WHILE v_cursor <= least(v_limit, coalesce(r.end_date, v_limit)) LOOP
            INSERT INTO app.expense_occurrences (tenant_id, recurring_expense_id, due_date, amount, currency)
            VALUES (r.tenant_id, r.id, v_cursor, r.amount, r.currency)
            ON CONFLICT (recurring_expense_id, due_date) DO NOTHING;

            IF FOUND THEN v_count := v_count + 1; END IF;
            v_cursor := (v_cursor + v_step)::date;
        END LOOP;
    END LOOP;

    RETURN v_count;
END
$$;

-- The bulk generator above runs for EVERY tenant and is reserved for the
-- nightly job. A tenant request that adds an expense needs its own occurrences
-- materialised immediately, and only its own - hence this narrow wrapper, which
-- takes the tenant from the session context rather than from an argument.
CREATE OR REPLACE FUNCTION app.generate_my_expense_occurrences(p_horizon_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
    r        record;
    v_cursor date;
    v_step   interval;
    v_count  integer := 0;
    v_limit  date := current_date + p_horizon_days;
    v_tenant uuid := app.current_tenant_id();
BEGIN
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'tenant context required' USING ERRCODE = '42501';
    END IF;

    FOR r IN
        SELECT * FROM app.recurring_expenses
        WHERE tenant_id = v_tenant
          AND is_active AND (end_date IS NULL OR end_date >= current_date)
    LOOP
        v_step := CASE r.period
            WHEN 'weekly'    THEN interval '1 week'
            WHEN 'monthly'   THEN interval '1 month'
            WHEN 'quarterly' THEN interval '3 months'
            WHEN 'yearly'    THEN interval '1 year'
        END;

        v_cursor := greatest(r.start_date, current_date - interval '1 month')::date;
        IF r.period = 'monthly' AND r.day_of_month IS NOT NULL THEN
            v_cursor := make_date(
                extract(year from v_cursor)::int,
                extract(month from v_cursor)::int,
                least(r.day_of_month,
                      extract(day from (date_trunc('month', v_cursor) + interval '1 month - 1 day'))::int));
        END IF;

        WHILE v_cursor <= least(v_limit, coalesce(r.end_date, v_limit)) LOOP
            INSERT INTO app.expense_occurrences (tenant_id, recurring_expense_id, due_date, amount, currency)
            VALUES (r.tenant_id, r.id, v_cursor, r.amount, r.currency)
            ON CONFLICT (recurring_expense_id, due_date) DO NOTHING;

            IF FOUND THEN v_count := v_count + 1; END IF;
            v_cursor := (v_cursor + v_step)::date;
        END LOOP;
    END LOOP;

    RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION app.generate_my_expense_occurrences(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.generate_my_expense_occurrences(integer)
    TO vgantt_api, vgantt_platform_api;

-- RLS + module gate for every finance table
SELECT app.apply_tenant_rls('app.finance_categories',  'finance');
SELECT app.apply_tenant_rls('app.recurring_expenses',  'finance');
SELECT app.apply_tenant_rls('app.expense_occurrences', 'finance');
SELECT app.apply_tenant_rls('app.customers',           'finance');
SELECT app.apply_tenant_rls('app.customer_invoices',   'finance');
SELECT app.apply_tenant_rls('app.customer_payments',   'finance');

-- 4 -------------------------------------------------------------------- views
CREATE VIEW app.v_receivables WITH (security_invoker = true) AS
SELECT
    i.id,
    i.tenant_id,
    i.invoice_no,
    i.customer_id,
    c.name AS customer_name,
    i.issue_date,
    i.due_date,
    i.total,
    i.paid_amount,
    (i.total - i.paid_amount) AS outstanding,
    i.currency,
    i.status,
    i.paid_at,
    (i.due_date - current_date) AS days_to_due,
    GREATEST(current_date - i.due_date, 0) AS days_overdue,
    CASE
        WHEN i.status = 'paid'            THEN 'paid'
        WHEN i.status = 'cancelled'       THEN 'cancelled'
        WHEN i.due_date <  current_date   THEN 'overdue'      -- UI paints this red
        WHEN i.due_date =  current_date   THEN 'due_today'
        WHEN i.due_date <= current_date+3 THEN 'due_soon'
        WHEN i.due_date <= current_date+7 THEN 'upcoming'
        ELSE 'scheduled'
    END AS risk_bucket
FROM app.customer_invoices i
JOIN app.customers c ON c.id = i.customer_id;

CREATE VIEW app.v_finance_monthly_summary WITH (security_invoker = true) AS
WITH months AS (
    SELECT t.id AS tenant_id, d::date AS month
    FROM platform.tenants t
    CROSS JOIN generate_series(
        date_trunc('month', current_date) - interval '11 months',
        date_trunc('month', current_date),
        interval '1 month') AS d
),
income AS (
    SELECT tenant_id, date_trunc('month', paid_on)::date AS month, sum(amount) AS collected
    FROM app.customer_payments GROUP BY 1, 2
),
billed AS (
    SELECT tenant_id, date_trunc('month', issue_date)::date AS month, sum(total) AS invoiced
    FROM app.customer_invoices WHERE status <> 'cancelled' GROUP BY 1, 2
),
expense AS (
    SELECT tenant_id, date_trunc('month', due_date)::date AS month,
           sum(amount) FILTER (WHERE status = 'paid')                     AS expense_paid,
           sum(amount) FILTER (WHERE status IN ('pending', 'overdue'))    AS expense_open
    FROM app.expense_occurrences GROUP BY 1, 2
)
SELECT
    m.tenant_id,
    m.month,
    coalesce(b.invoiced, 0)      AS invoiced,
    coalesce(i.collected, 0)     AS collected,
    coalesce(e.expense_paid, 0)  AS expense_paid,
    coalesce(e.expense_open, 0)  AS expense_open,
    coalesce(i.collected, 0) - coalesce(e.expense_paid, 0) AS net_cash
FROM months m
LEFT JOIN income  i ON i.tenant_id = m.tenant_id AND i.month = m.month
LEFT JOIN billed  b ON b.tenant_id = m.tenant_id AND b.month = m.month
LEFT JOIN expense e ON e.tenant_id = m.tenant_id AND e.month = m.month;

CREATE VIEW app.v_receivables_aging WITH (security_invoker = true) AS
SELECT
    tenant_id,
    CASE
        WHEN days_overdue = 0            THEN 'current'
        WHEN days_overdue BETWEEN 1  AND 30  THEN '1-30'
        WHEN days_overdue BETWEEN 31 AND 60  THEN '31-60'
        WHEN days_overdue BETWEEN 61 AND 90  THEN '61-90'
        ELSE '90+'
    END AS bucket,
    count(*)          AS invoice_count,
    sum(outstanding)  AS outstanding
FROM app.v_receivables
WHERE status NOT IN ('paid', 'cancelled')
GROUP BY 1, 2;

GRANT SELECT ON app.v_receivables, app.v_finance_monthly_summary, app.v_receivables_aging
    TO vgantt_api, vgantt_platform_api;

-- 5 ------------------------------------------------------ alert registration
CREATE OR REPLACE FUNCTION app.generate_receivable_alerts(p_as_of date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
DECLARE
    r       record;
    v_days  integer;
    v_count integer := 0;
BEGIN
    FOR r IN
        SELECT i.id, i.tenant_id, i.invoice_no, i.due_date, i.total, i.paid_amount,
               i.currency, c.name AS customer_name
        FROM app.customer_invoices i
        JOIN app.customers c        ON c.id = i.customer_id
        JOIN platform.tenants t     ON t.id = i.tenant_id
        WHERE i.status IN ('sent', 'partially_paid', 'overdue')
          AND t.status <> 'cancelled'
          AND i.due_date BETWEEN p_as_of - 60 AND p_as_of + 45
          AND app.tenant_has_module(i.tenant_id, 'finance')
    LOOP
        v_days := r.due_date - p_as_of;

        -- Default policy is {3}: a reminder three days before the due date,
        -- then escalations once the payment is actually late.
        CONTINUE WHEN NOT (
            v_days = ANY (platform.thresholds_for(r.tenant_id, 'receivable'))
            OR v_days = 0
            OR v_days IN (-1, -7, -15, -30)
        );

        IF app.emit_notification(
            r.tenant_id,
            'finance.receivable',
            'finance',
            CASE
                WHEN v_days < 0  THEN format('%s: %s no.lu fatura %s gün gecikti',
                                             r.customer_name, r.invoice_no, abs(v_days))
                WHEN v_days = 0  THEN format('%s: %s no.lu faturanın vadesi bugün',
                                             r.customer_name, r.invoice_no)
                ELSE format('%s: %s no.lu fatura vadesine %s gün kaldı',
                            r.customer_name, r.invoice_no, v_days)
            END,
            format('Kalan tutar: %s %s - Vade: %s',
                   to_char(r.total - r.paid_amount, 'FM999G999G990D00'),
                   r.currency, to_char(r.due_date, 'DD.MM.YYYY')),
            'receivable', r.id::text, v_days, r.due_date,
            '/finance/invoices/' || r.id::text)
        THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION app.generate_expense_alerts(p_as_of date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
DECLARE
    r       record;
    v_days  integer;
    v_count integer := 0;
BEGIN
    FOR r IN
        SELECT o.id, o.tenant_id, o.due_date, o.amount, o.currency, e.title
        FROM app.expense_occurrences o
        JOIN app.recurring_expenses e ON e.id = o.recurring_expense_id
        JOIN platform.tenants t       ON t.id = o.tenant_id
        WHERE o.status IN ('pending', 'overdue')
          AND t.status <> 'cancelled'
          AND o.due_date BETWEEN p_as_of - 30 AND p_as_of + 45
          AND app.tenant_has_module(o.tenant_id, 'finance')
    LOOP
        v_days := r.due_date - p_as_of;
        CONTINUE WHEN NOT (
            v_days = ANY (platform.thresholds_for(r.tenant_id, 'recurring_expense'))
            OR v_days IN (0, -1, -7)
        );

        IF app.emit_notification(
            r.tenant_id, 'finance.expense', 'finance',
            CASE
                WHEN v_days < 0 THEN format('%s ödemesi %s gün gecikti', r.title, abs(v_days))
                WHEN v_days = 0 THEN format('%s ödemesi bugün', r.title)
                ELSE format('%s ödemesine %s gün kaldı', r.title, v_days)
            END,
            format('Tutar: %s %s - Vade: %s',
                   to_char(r.amount, 'FM999G999G990D00'), r.currency,
                   to_char(r.due_date, 'DD.MM.YYYY')),
            'recurring_expense', r.id::text, v_days, r.due_date, '/finance/expenses')
        THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END
$$;

INSERT INTO platform.alert_sources (source_type, module_key, audience, generator, default_thresholds, description)
VALUES
    ('receivable',        'finance', 'tenant', 'app.generate_receivable_alerts(date)',
     ARRAY[3], 'Müşteri alacakları: vadeye 3 gün kala hatırlatma + gecikme eskalasyonu'),
    ('recurring_expense', 'finance', 'tenant', 'app.generate_expense_alerts(date)',
     ARRAY[7, 3], 'Aylık düzenli gider ödemeleri')
ON CONFLICT (source_type) DO UPDATE
    SET generator = EXCLUDED.generator, default_thresholds = EXCLUDED.default_thresholds;

INSERT INTO platform.schema_migrations(version) VALUES ('0007_module_finance')
ON CONFLICT DO NOTHING;
