-- =============================================================================
-- 0003_platform_billing.sql
-- Plans, the module catalogue, per-tenant module licensing, subscriptions,
-- and the VganttAdmin -> tenant billing ledger.
-- =============================================================================
\set ON_ERROR_STOP on

CREATE TYPE platform.billing_period      AS ENUM ('monthly', 'quarterly', 'yearly');
CREATE TYPE platform.subscription_status AS ENUM ('trial', 'active', 'past_due', 'suspended', 'cancelled', 'expired');
CREATE TYPE platform.invoice_status      AS ENUM ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void');
CREATE TYPE platform.payment_method      AS ENUM ('bank_transfer', 'credit_card', 'cash', 'cheque', 'other');

-- -----------------------------------------------------------------------------
-- Module catalogue
--
-- The single source of truth for "what can be sold / switched on". Adding a
-- module to the product = one INSERT here (see docs/ADDING-A-MODULE.md).
-- -----------------------------------------------------------------------------
CREATE TABLE platform.modules (
    key              text PRIMARY KEY
                     CONSTRAINT modules_key_format CHECK (key ~ '^[a-z][a-z0-9-]{1,40}$'),
    name             text NOT NULL,
    description      text,
    category         text NOT NULL DEFAULT 'general',
    icon             text,
    is_core          boolean NOT NULL DEFAULT false,   -- core modules cannot be switched off
    requires_desktop boolean NOT NULL DEFAULT false,   -- e.g. the local vault needs the desktop shell
    stores_server_data boolean NOT NULL DEFAULT true,  -- false => module keeps data client-side only
    sort_order       smallint NOT NULL DEFAULT 100,
    is_active        boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN platform.modules.stores_server_data IS
'false marks a module that is contractually forbidden from persisting user data
server-side (the local password vault). Enforced by the DDL guard in 0008.';

CREATE OR REPLACE TRIGGER trg_modules_updated_at
    BEFORE UPDATE ON platform.modules
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Catalogue is public to every authenticated tenant (needed to render the menu).
ALTER TABLE platform.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.modules FORCE ROW LEVEL SECURITY;
CREATE POLICY modules_readable ON platform.modules
    FOR SELECT TO vgantt_api USING (is_active);

-- -----------------------------------------------------------------------------
-- Plans and the modules each plan bundles
-- -----------------------------------------------------------------------------
CREATE TABLE platform.plans (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code           citext NOT NULL UNIQUE,
    name           text NOT NULL,
    description    text,
    billing_period platform.billing_period NOT NULL DEFAULT 'yearly',
    price          numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    currency       char(3) NOT NULL DEFAULT 'TRY',
    max_users      integer CHECK (max_users IS NULL OR max_users > 0),
    trial_days     smallint NOT NULL DEFAULT 14 CHECK (trial_days >= 0),
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_plans_updated_at
    BEFORE UPDATE ON platform.plans
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE platform.plan_modules (
    plan_id    uuid NOT NULL REFERENCES platform.plans(id) ON DELETE CASCADE,
    module_key text NOT NULL REFERENCES platform.modules(key) ON DELETE CASCADE,
    PRIMARY KEY (plan_id, module_key)
);

-- -----------------------------------------------------------------------------
-- Subscriptions
--
-- ends_on is the licence expiry date the 30/15/7/3-day alert engine watches.
-- The exclusion constraint stops two live subscriptions overlapping in time for
-- the same tenant, which is the classic source of "which licence applies?" bugs.
-- -----------------------------------------------------------------------------
CREATE TABLE platform.subscriptions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    plan_id         uuid NOT NULL REFERENCES platform.plans(id) ON DELETE RESTRICT,
    status          platform.subscription_status NOT NULL DEFAULT 'trial',
    starts_on       date NOT NULL DEFAULT current_date,
    ends_on         date NOT NULL,
    trial_ends_on   date,
    seats           integer NOT NULL DEFAULT 5 CHECK (seats > 0),
    price_override  numeric(12,2) CHECK (price_override IS NULL OR price_override >= 0),
    currency        char(3) NOT NULL DEFAULT 'TRY',
    auto_renew      boolean NOT NULL DEFAULT true,
    renewal_period  platform.billing_period NOT NULL DEFAULT 'yearly',
    cancelled_at    timestamptz,
    cancel_reason   text,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT subscriptions_period_valid CHECK (ends_on >= starts_on),
    CONSTRAINT subscriptions_no_overlap
        EXCLUDE USING gist (
            tenant_id WITH =,
            daterange(starts_on, ends_on, '[]') WITH &&
        ) WHERE (status IN ('trial', 'active', 'past_due'))
);

CREATE INDEX subscriptions_tenant_idx  ON platform.subscriptions (tenant_id, ends_on DESC);
CREATE INDEX subscriptions_expiry_idx  ON platform.subscriptions (ends_on)
    WHERE status IN ('trial', 'active', 'past_due');

CREATE OR REPLACE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON platform.subscriptions
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE platform.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_reads_own_subscription ON platform.subscriptions
    FOR SELECT TO vgantt_api USING (tenant_id = app.current_tenant_id());

-- -----------------------------------------------------------------------------
-- Per-tenant module licensing  <- the VganttAdmin one-click switch
--
-- is_enabled false (or valid_until in the past) removes the module from the
-- tenant's menu, makes the API guard reject the route, AND makes the module's
-- rows invisible at the RLS layer. Data is retained, not deleted: flipping the
-- switch back restores everything.
-- -----------------------------------------------------------------------------
CREATE TABLE platform.tenant_modules (
    tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    module_key   text NOT NULL REFERENCES platform.modules(key) ON DELETE RESTRICT,
    is_enabled   boolean NOT NULL DEFAULT false,
    valid_until  date,                       -- NULL = follows the subscription
    seat_limit   integer CHECK (seat_limit IS NULL OR seat_limit > 0),
    settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled_at   timestamptz,
    disabled_at  timestamptz,
    updated_by   uuid REFERENCES platform.admin_users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, module_key)
);

CREATE INDEX tenant_modules_enabled_idx ON platform.tenant_modules (module_key)
    WHERE is_enabled;
CREATE INDEX tenant_modules_expiry_idx  ON platform.tenant_modules (valid_until)
    WHERE is_enabled AND valid_until IS NOT NULL;

-- Keep enabled_at / disabled_at truthful without trusting the caller.
CREATE OR REPLACE FUNCTION platform.stamp_module_toggle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.is_enabled THEN NEW.enabled_at := now(); END IF;
    ELSIF NEW.is_enabled IS DISTINCT FROM OLD.is_enabled THEN
        IF NEW.is_enabled THEN
            NEW.enabled_at  := now();
            NEW.disabled_at := NULL;
        ELSE
            NEW.disabled_at := now();
        END IF;
    END IF;
    RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER trg_tenant_modules_toggle
    BEFORE INSERT OR UPDATE ON platform.tenant_modules
    FOR EACH ROW EXECUTE FUNCTION platform.stamp_module_toggle();

CREATE OR REPLACE TRIGGER trg_tenant_modules_updated_at
    BEFORE UPDATE ON platform.tenant_modules
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE platform.tenant_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_modules FORCE ROW LEVEL SECURITY;
-- Read-only for tenants: only VganttAdmin may flip the switch.
CREATE POLICY tenant_reads_own_modules ON platform.tenant_modules
    FOR SELECT TO vgantt_api USING (tenant_id = app.current_tenant_id());

-- -----------------------------------------------------------------------------
-- Module licensing lookup (used by both the RLS layer and the API guard)
--
-- SECURITY DEFINER: the check must work even for a tenant whose own SELECT on
-- platform.tenant_modules is filtered, and must not recurse into RLS.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tenant_has_module(p_tenant_id uuid, p_module_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM platform.tenant_modules tm
        WHERE tm.tenant_id = p_tenant_id
          AND tm.module_key = p_module_key
          AND tm.is_enabled
          AND (tm.valid_until IS NULL OR tm.valid_until >= current_date)
    )
$$;

COMMENT ON FUNCTION app.tenant_has_module(uuid, text) IS
'True when VganttAdmin has the module switched on for the tenant and the module
license has not expired. Used as a second line of defence inside RLS policies.';

-- -----------------------------------------------------------------------------
-- Billing ledger: what VganttAdmin invoices the tenant, and what was collected
-- -----------------------------------------------------------------------------
CREATE TABLE platform.invoices (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
    subscription_id uuid REFERENCES platform.subscriptions(id) ON DELETE SET NULL,
    invoice_no      citext NOT NULL UNIQUE,
    issue_date      date NOT NULL DEFAULT current_date,
    due_date        date NOT NULL,
    period_start    date,
    period_end      date,
    subtotal        numeric(12,2) NOT NULL CHECK (subtotal >= 0),
    tax_rate        numeric(5,2)  NOT NULL DEFAULT 20.00 CHECK (tax_rate >= 0),
    tax_amount      numeric(12,2) GENERATED ALWAYS AS (round(subtotal * tax_rate / 100, 2)) STORED,
    total           numeric(12,2) GENERATED ALWAYS AS (subtotal + round(subtotal * tax_rate / 100, 2)) STORED,
    currency        char(3) NOT NULL DEFAULT 'TRY',
    status          platform.invoice_status NOT NULL DEFAULT 'draft',
    paid_at         timestamptz,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT invoices_due_after_issue CHECK (due_date >= issue_date)
);

CREATE INDEX invoices_tenant_idx ON platform.invoices (tenant_id, issue_date DESC);
CREATE INDEX invoices_open_idx   ON platform.invoices (due_date)
    WHERE status IN ('sent', 'partially_paid', 'overdue');

CREATE OR REPLACE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON platform.invoices
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE platform.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_reads_own_invoices ON platform.invoices
    FOR SELECT TO vgantt_api USING (tenant_id = app.current_tenant_id());

CREATE TABLE platform.payments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE RESTRICT,
    invoice_id  uuid REFERENCES platform.invoices(id) ON DELETE SET NULL,
    amount      numeric(12,2) NOT NULL CHECK (amount > 0),
    currency    char(3) NOT NULL DEFAULT 'TRY',
    paid_on     date NOT NULL DEFAULT current_date,
    method      platform.payment_method NOT NULL DEFAULT 'bank_transfer',
    reference   text,
    recorded_by uuid REFERENCES platform.admin_users(id) ON DELETE SET NULL,
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_tenant_idx  ON platform.payments (tenant_id, paid_on DESC);
CREATE INDEX payments_invoice_idx ON platform.payments (invoice_id);

ALTER TABLE platform.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_reads_own_payments ON platform.payments
    FOR SELECT TO vgantt_api USING (tenant_id = app.current_tenant_id());

-- Recompute invoice status from the payment ledger. Keeps "who owes what"
-- correct no matter which code path recorded the payment.
CREATE OR REPLACE FUNCTION platform.refresh_invoice_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_invoice_id uuid := coalesce(NEW.invoice_id, OLD.invoice_id);
    v_total      numeric(12,2);
    v_paid       numeric(12,2);
    v_due        date;
BEGIN
    IF v_invoice_id IS NULL THEN
        RETURN coalesce(NEW, OLD);
    END IF;

    SELECT i.total, i.due_date INTO v_total, v_due
    FROM platform.invoices i WHERE i.id = v_invoice_id;

    SELECT coalesce(sum(p.amount), 0) INTO v_paid
    FROM platform.payments p WHERE p.invoice_id = v_invoice_id;

    UPDATE platform.invoices SET
        status = CASE
            WHEN v_paid >= v_total THEN 'paid'::platform.invoice_status
            WHEN v_paid > 0        THEN 'partially_paid'::platform.invoice_status
            WHEN v_due < current_date THEN 'overdue'::platform.invoice_status
            ELSE 'sent'::platform.invoice_status
        END,
        paid_at = CASE WHEN v_paid >= v_total THEN now() ELSE NULL END
    WHERE id = v_invoice_id
      AND status <> 'void';

    RETURN coalesce(NEW, OLD);
END
$$;

CREATE OR REPLACE TRIGGER trg_payments_refresh_invoice
    AFTER INSERT OR UPDATE OR DELETE ON platform.payments
    FOR EACH ROW EXECUTE FUNCTION platform.refresh_invoice_status();

INSERT INTO platform.schema_migrations(version) VALUES ('0003_platform_billing')
ON CONFLICT DO NOTHING;
