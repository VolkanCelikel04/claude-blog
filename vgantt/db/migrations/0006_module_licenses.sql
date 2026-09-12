-- =============================================================================
-- 0006_module_licenses.sql   ---  MODULE A: Licence & expiry tracking
--
-- Self-registering module migration. It contributes, in this order:
--   1. its catalogue row in platform.modules
--   2. its permissions
--   3. its tables, wired into RLS with the module gate
--   4. its reporting view
--   5. its alert generator + registry row
--
-- This is the exact shape docs/ADDING-A-MODULE.md tells you to copy.
-- =============================================================================
\set ON_ERROR_STOP on

-- 1 ---------------------------------------------------------------- catalogue
INSERT INTO platform.modules (key, name, description, category, icon, sort_order, stores_server_data)
VALUES ('licenses', 'Lisans ve Süre Takibi',
        'Yazılım, domain, SSL ve abonelik bitiş sürelerinin takibi ve süresi yaklaşan kalemler için uyarılar.',
        'operations', 'calendar-clock', 10, true)
ON CONFLICT (key) DO UPDATE
    SET name = EXCLUDED.name, description = EXCLUDED.description;

-- 2 -------------------------------------------------------------- permissions
INSERT INTO app.permissions (key, module_key, description) VALUES
    ('licenses.read',   'licenses', 'Lisans kayıtlarını görüntüleme'),
    ('licenses.write',  'licenses', 'Lisans kaydı ekleme ve güncelleme'),
    ('licenses.delete', 'licenses', 'Lisans kaydı silme'),
    ('licenses.renew',  'licenses', 'Lisans yenileme işlemi')
ON CONFLICT (key) DO NOTHING;

-- 3 ------------------------------------------------------------------- tables
CREATE TYPE app.license_type AS ENUM (
    'software', 'domain', 'ssl_certificate', 'hosting', 'subscription',
    'hardware_warranty', 'insurance', 'certification', 'other');

CREATE TYPE app.license_status AS ENUM ('active', 'expired', 'cancelled', 'replaced');

CREATE TABLE app.licenses (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    name              text NOT NULL CHECK (length(btrim(name)) > 0),
    license_type      app.license_type NOT NULL DEFAULT 'software',
    vendor            text,
    account_reference text,        -- customer / account no. NOT a credential.
    start_date        date,
    end_date          date NOT NULL,
    auto_renew        boolean NOT NULL DEFAULT false,
    renewal_months    smallint CHECK (renewal_months IS NULL OR renewal_months BETWEEN 1 AND 120),
    cost              numeric(12,2) CHECK (cost IS NULL OR cost >= 0),
    currency          char(3) NOT NULL DEFAULT 'TRY',
    owner_user_id     uuid REFERENCES app.users(id) ON DELETE SET NULL,
    status            app.license_status NOT NULL DEFAULT 'active',
    tags              text[] NOT NULL DEFAULT '{}',
    notes             text,
    created_by        uuid REFERENCES app.users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT licenses_dates_ordered CHECK (start_date IS NULL OR end_date >= start_date),
    CONSTRAINT licenses_unique_per_tenant UNIQUE (tenant_id, name, license_type, end_date)
);

COMMENT ON COLUMN app.licenses.account_reference IS
'Vendor-side account or customer number. Passwords and API keys belong in the
local vault (module C) and must never be written here.';

CREATE INDEX licenses_expiry_idx ON app.licenses (tenant_id, end_date)
    WHERE status = 'active';
CREATE INDEX licenses_type_idx   ON app.licenses (tenant_id, license_type);
CREATE INDEX licenses_tags_idx   ON app.licenses USING gin (tags);

CREATE TABLE app.license_renewals (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    license_id        uuid NOT NULL REFERENCES app.licenses(id) ON DELETE CASCADE,
    previous_end_date date NOT NULL,
    new_end_date      date NOT NULL,
    cost              numeric(12,2) CHECK (cost IS NULL OR cost >= 0),
    currency          char(3) NOT NULL DEFAULT 'TRY',
    renewed_at        timestamptz NOT NULL DEFAULT now(),
    renewed_by        uuid REFERENCES app.users(id) ON DELETE SET NULL,
    notes             text,
    CONSTRAINT license_renewals_moves_forward CHECK (new_end_date > previous_end_date)
);

CREATE INDEX license_renewals_license_idx ON app.license_renewals (license_id, renewed_at DESC);

-- The second argument gates these tables behind the module switch: when
-- VganttAdmin turns 'licenses' off, the rows stop existing for the tenant API.
SELECT app.apply_tenant_rls('app.licenses',         'licenses');
SELECT app.apply_tenant_rls('app.license_renewals', 'licenses');

-- Expiry is derived, never stored, so a row cannot go stale overnight.
CREATE OR REPLACE FUNCTION app.expire_stale_licenses()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
    WITH updated AS (
        UPDATE app.licenses
        SET status = 'expired'
        WHERE status = 'active' AND end_date < current_date
        RETURNING 1)
    SELECT count(*)::integer FROM updated
$$;

-- 4 --------------------------------------------------------------------- view
CREATE VIEW app.v_license_expiry WITH (security_invoker = true) AS
SELECT
    l.id,
    l.tenant_id,
    l.name,
    l.license_type,
    l.vendor,
    l.end_date,
    l.cost,
    l.currency,
    l.auto_renew,
    l.status,
    (l.end_date - current_date) AS days_remaining,
    CASE
        WHEN l.status <> 'active'          THEN 'inactive'
        WHEN l.end_date <  current_date    THEN 'expired'
        WHEN l.end_date <= current_date+3  THEN 'critical'
        WHEN l.end_date <= current_date+7  THEN 'urgent'
        WHEN l.end_date <= current_date+15 THEN 'warning'
        WHEN l.end_date <= current_date+30 THEN 'upcoming'
        ELSE 'ok'
    END AS expiry_bucket,
    u.full_name AS owner_name
FROM app.licenses l
LEFT JOIN app.users u ON u.id = l.owner_user_id;

GRANT SELECT ON app.v_license_expiry TO vgantt_api, vgantt_platform_api;

-- 5 ------------------------------------------------------ alert registration
CREATE OR REPLACE FUNCTION app.generate_license_alerts(p_as_of date DEFAULT current_date)
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
        SELECT l.id, l.tenant_id, l.name, l.license_type, l.vendor, l.end_date
        FROM app.licenses l
        JOIN platform.tenants t ON t.id = l.tenant_id
        WHERE l.status = 'active'
          AND t.status <> 'cancelled'
          AND l.end_date BETWEEN p_as_of - 7 AND p_as_of + 400
          AND app.tenant_has_module(l.tenant_id, 'licenses')
    LOOP
        v_days := r.end_date - p_as_of;

        CONTINUE WHEN NOT (
            v_days = ANY (platform.thresholds_for(r.tenant_id, 'license'))
            OR v_days = 0
            OR v_days = -1
        );

        IF app.emit_notification(
            r.tenant_id,
            'license.expiry',
            'licenses',
            CASE
                WHEN v_days < 0  THEN format('%s süresi doldu', r.name)
                WHEN v_days = 0  THEN format('%s bugün sona eriyor', r.name)
                ELSE format('%s için son %s gün', r.name, v_days)
            END,
            format('%s (%s)%s bitiş tarihi: %s',
                   r.name,
                   r.license_type,
                   coalesce(' - ' || r.vendor, ''),
                   to_char(r.end_date, 'DD.MM.YYYY')),
            'license', r.id::text, v_days, r.end_date,
            '/licenses/' || r.id::text)
        THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END
$$;

INSERT INTO platform.alert_sources (source_type, module_key, audience, generator, default_thresholds, description)
VALUES ('license', 'licenses', 'tenant', 'app.generate_license_alerts(date)',
        ARRAY[30, 15, 7, 3], 'Lisans / domain / SSL bitiş uyarıları')
ON CONFLICT (source_type) DO UPDATE
    SET generator = EXCLUDED.generator, default_thresholds = EXCLUDED.default_thresholds;

INSERT INTO platform.schema_migrations(version) VALUES ('0006_module_licenses')
ON CONFLICT DO NOTHING;
