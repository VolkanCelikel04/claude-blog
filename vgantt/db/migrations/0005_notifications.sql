-- =============================================================================
-- 0005_notifications.sql
-- Notification storage + the pluggable alert engine that produces the
-- 30 / 15 / 7 / 3 day warnings.
--
-- Design note: the engine does not know about licences, subscriptions or
-- invoices. It iterates platform.alert_sources and calls whatever generator
-- function each source registered. A new module adds one row + one function
-- and inherits the whole warning pipeline.
-- =============================================================================
\set ON_ERROR_STOP on

CREATE TYPE app.notification_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE platform.alert_audience   AS ENUM ('tenant', 'platform');

-- -----------------------------------------------------------------------------
-- Tenant-facing notifications
-- -----------------------------------------------------------------------------
CREATE TABLE app.notifications (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    user_id        uuid REFERENCES app.users(id) ON DELETE CASCADE, -- NULL = whole tenant
    severity       app.notification_severity NOT NULL DEFAULT 'info',
    category       text NOT NULL,                 -- 'license.expiry', 'finance.receivable' ...
    module_key     text REFERENCES platform.modules(key) ON DELETE CASCADE,
    title          text NOT NULL,
    body           text,
    source_type    text,
    source_id      text,
    threshold_days integer,                       -- 30 / 15 / 7 / 3, or 0 for "due today",
                                                  -- negative for overdue
    due_date       date,
    action_url     text,
    dedupe_key     text NOT NULL,
    is_read        boolean NOT NULL DEFAULT false,
    read_at        timestamptz,
    dismissed_at   timestamptz,
    delivered_at   timestamptz,                   -- set when an out-of-band channel fired
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notifications_dedupe_unique UNIQUE (tenant_id, dedupe_key)
);

CREATE INDEX notifications_inbox_idx ON app.notifications (tenant_id, created_at DESC)
    WHERE NOT is_read AND dismissed_at IS NULL;
CREATE INDEX notifications_due_idx   ON app.notifications (tenant_id, due_date);
CREATE INDEX notifications_undelivered_idx ON app.notifications (created_at)
    WHERE delivered_at IS NULL;

SELECT app.apply_tenant_rls('app.notifications');

-- -----------------------------------------------------------------------------
-- VganttAdmin notifications (cross-tenant: subscription + module licence expiry)
-- -----------------------------------------------------------------------------
CREATE TABLE platform.admin_notifications (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid REFERENCES platform.tenants(id) ON DELETE CASCADE,
    severity       app.notification_severity NOT NULL DEFAULT 'info',
    category       text NOT NULL,
    title          text NOT NULL,
    body           text,
    source_type    text,
    source_id      text,
    threshold_days integer,
    due_date       date,
    dedupe_key     text NOT NULL UNIQUE,
    is_read        boolean NOT NULL DEFAULT false,
    read_at        timestamptz,
    delivered_at   timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_notifications_inbox_idx ON platform.admin_notifications (created_at DESC)
    WHERE NOT is_read;

-- No grant for vgantt_api: tenants never see the operator inbox.

-- -----------------------------------------------------------------------------
-- Alert source registry + per-tenant threshold policies
-- -----------------------------------------------------------------------------
CREATE TABLE platform.alert_sources (
    source_type        text PRIMARY KEY,
    module_key         text REFERENCES platform.modules(key) ON DELETE CASCADE,
    audience           platform.alert_audience NOT NULL DEFAULT 'tenant',
    generator          text NOT NULL,       -- e.g. 'app.generate_license_alerts(date)'
    default_thresholds integer[] NOT NULL DEFAULT ARRAY[30, 15, 7, 3],
    description        text,
    is_active          boolean NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT alert_sources_generator_exists
        CHECK (to_regprocedure(generator) IS NOT NULL),
    CONSTRAINT alert_sources_thresholds_sane
        CHECK (array_length(default_thresholds, 1) BETWEEN 1 AND 10)
);

COMMENT ON TABLE platform.alert_sources IS
'Registry of everything that can expire. platform.run_alert_engine() iterates
this table; modules register themselves instead of the engine hard-coding them.';

CREATE TABLE platform.alert_policies (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid REFERENCES platform.tenants(id) ON DELETE CASCADE,  -- NULL = global default
    source_type text NOT NULL REFERENCES platform.alert_sources(source_type) ON DELETE CASCADE,
    thresholds  integer[] NOT NULL,
    channels    text[] NOT NULL DEFAULT ARRAY['in_app'],   -- in_app | email | webhook
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT alert_policies_unique UNIQUE NULLS NOT DISTINCT (tenant_id, source_type)
);

ALTER TABLE platform.alert_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.alert_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_reads_own_alert_policies ON platform.alert_policies
    FOR SELECT TO vgantt_api
    USING (tenant_id IS NULL OR tenant_id = app.current_tenant_id());

CREATE OR REPLACE TRIGGER trg_alert_policies_updated_at
    BEFORE UPDATE ON platform.alert_policies
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Effective thresholds: tenant override -> global override -> source default.
CREATE OR REPLACE FUNCTION platform.thresholds_for(p_tenant_id uuid, p_source_type text)
RETURNS integer[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
    SELECT coalesce(
        (SELECT thresholds FROM platform.alert_policies
          WHERE source_type = p_source_type AND tenant_id = p_tenant_id AND is_active),
        (SELECT thresholds FROM platform.alert_policies
          WHERE source_type = p_source_type AND tenant_id IS NULL AND is_active),
        (SELECT default_thresholds FROM platform.alert_sources
          WHERE source_type = p_source_type),
        ARRAY[30, 15, 7, 3]
    )
$$;

-- -----------------------------------------------------------------------------
-- Severity ladder shared by every generator
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.severity_for_days(p_days integer)
RETURNS app.notification_severity
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_days IS NULL THEN 'info'
        WHEN p_days <= 0  THEN 'critical'   -- due today or already overdue
        WHEN p_days <= 3  THEN 'critical'
        WHEN p_days <= 7  THEN 'warning'
        WHEN p_days <= 15 THEN 'warning'
        ELSE 'info'
    END::app.notification_severity
$$;

-- -----------------------------------------------------------------------------
-- Idempotent notification writers used by every generator.
--
-- dedupe_key embeds the due date, so renewing a licence (new due date) produces
-- a fresh warning ladder while re-running the engine ten times a day does not.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.emit_notification(
    p_tenant_id      uuid,
    p_category       text,
    p_module_key     text,
    p_title          text,
    p_body           text,
    p_source_type    text,
    p_source_id      text,
    p_threshold_days integer,
    p_due_date       date,
    p_action_url     text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
DECLARE
    v_key      text;
    v_inserted boolean;
BEGIN
    v_key := format('%s:%s:%s:%s', p_source_type, p_source_id,
                    coalesce(p_due_date::text, 'na'), p_threshold_days);

    INSERT INTO app.notifications (
        tenant_id, severity, category, module_key, title, body,
        source_type, source_id, threshold_days, due_date, action_url, dedupe_key)
    VALUES (
        p_tenant_id, app.severity_for_days(p_threshold_days), p_category, p_module_key,
        p_title, p_body, p_source_type, p_source_id, p_threshold_days,
        p_due_date, p_action_url, v_key)
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END
$$;

CREATE OR REPLACE FUNCTION platform.emit_admin_notification(
    p_tenant_id      uuid,
    p_category       text,
    p_title          text,
    p_body           text,
    p_source_type    text,
    p_source_id      text,
    p_threshold_days integer,
    p_due_date       date
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
DECLARE
    v_key text;
BEGIN
    v_key := format('%s:%s:%s:%s', p_source_type, p_source_id,
                    coalesce(p_due_date::text, 'na'), p_threshold_days);

    INSERT INTO platform.admin_notifications (
        tenant_id, severity, category, title, body,
        source_type, source_id, threshold_days, due_date, dedupe_key)
    VALUES (
        p_tenant_id, app.severity_for_days(p_threshold_days), p_category, p_title, p_body,
        p_source_type, p_source_id, p_threshold_days, p_due_date, v_key)
    ON CONFLICT (dedupe_key) DO NOTHING;

    RETURN FOUND;
END
$$;

-- -----------------------------------------------------------------------------
-- Subscription + module licence expiry generators (audience: platform & tenant)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.generate_subscription_alerts(p_as_of date DEFAULT current_date)
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
        SELECT s.id, s.tenant_id, s.ends_on, s.status, t.name AS tenant_name, p.name AS plan_name
        FROM platform.subscriptions s
        JOIN platform.tenants t ON t.id = s.tenant_id
        JOIN platform.plans   p ON p.id = s.plan_id
        WHERE s.status IN ('trial', 'active', 'past_due')
          AND t.status <> 'cancelled'
          AND s.ends_on >= p_as_of - 30      -- keep nagging for a month after expiry
    LOOP
        v_days := r.ends_on - p_as_of;

        -- Only fire on a registered threshold, on the due date itself, or once
        -- the subscription has actually lapsed.
        CONTINUE WHEN NOT (
            v_days = ANY (platform.thresholds_for(r.tenant_id, 'subscription'))
            OR v_days = 0
            OR v_days = -1
        );

        IF platform.emit_admin_notification(
            r.tenant_id,
            'subscription.expiry',
            CASE WHEN v_days < 0
                 THEN format('%s aboneliği süresi doldu', r.tenant_name)
                 WHEN v_days = 0
                 THEN format('%s aboneliği bugün bitiyor', r.tenant_name)
                 ELSE format('%s aboneliğine %s gün kaldı', r.tenant_name, v_days) END,
            format('%s planı %s tarihinde sona eriyor.', r.plan_name, to_char(r.ends_on, 'DD.MM.YYYY')),
            'subscription', r.id::text, v_days, r.ends_on)
        THEN
            v_count := v_count + 1;
        END IF;

        -- The tenant is warned too, so renewal is not a surprise.
        IF app.emit_notification(
            r.tenant_id, 'subscription.expiry', NULL,
            CASE WHEN v_days < 0
                 THEN 'Aboneliğinizin süresi doldu'
                 WHEN v_days = 0
                 THEN 'Aboneliğiniz bugün sona eriyor'
                 ELSE format('Aboneliğinizin bitimine %s gün kaldı', v_days) END,
            format('%s planı %s tarihinde sona eriyor. Kesintisiz kullanım için yenileyin.',
                   r.plan_name, to_char(r.ends_on, 'DD.MM.YYYY')),
            'subscription', r.id::text, v_days, r.ends_on, '/settings/subscription')
        THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END
$$;

CREATE OR REPLACE FUNCTION platform.generate_module_license_alerts(p_as_of date DEFAULT current_date)
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
        SELECT tm.tenant_id, tm.module_key, tm.valid_until, m.name AS module_name, t.name AS tenant_name
        FROM platform.tenant_modules tm
        JOIN platform.modules m ON m.key = tm.module_key
        JOIN platform.tenants t ON t.id = tm.tenant_id
        WHERE tm.is_enabled
          AND tm.valid_until IS NOT NULL
          AND tm.valid_until >= p_as_of - 7
          AND t.status <> 'cancelled'
    LOOP
        v_days := r.valid_until - p_as_of;
        CONTINUE WHEN NOT (
            v_days = ANY (platform.thresholds_for(r.tenant_id, 'module_license'))
            OR v_days <= 0
        );

        IF platform.emit_admin_notification(
            r.tenant_id, 'module.license.expiry',
            format('%s / %s modül lisansı %s', r.tenant_name, r.module_name,
                   CASE WHEN v_days <= 0 THEN 'sona erdi' ELSE format('%s gün içinde bitiyor', v_days) END),
            format('Modül lisansı bitiş tarihi: %s', to_char(r.valid_until, 'DD.MM.YYYY')),
            'module_license', r.tenant_id::text || ':' || r.module_key, v_days, r.valid_until)
        THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN v_count;
END
$$;

-- -----------------------------------------------------------------------------
-- The engine itself
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.run_alert_engine(p_as_of date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
DECLARE
    r        record;
    v_count  integer;
    v_result jsonb := '{}'::jsonb;
    v_total  integer := 0;
BEGIN
    FOR r IN
        SELECT s.source_type, s.generator, s.module_key
        FROM platform.alert_sources s
        WHERE s.is_active
          -- A module that nobody licenses does not need scanning.
          AND (s.module_key IS NULL OR EXISTS (
                SELECT 1 FROM platform.tenant_modules tm
                WHERE tm.module_key = s.module_key AND tm.is_enabled))
        ORDER BY s.source_type
    LOOP
        -- generator is validated by a CHECK constraint (to_regprocedure), so the
        -- dynamic call cannot be turned into an injection vector by data alone.
        EXECUTE format('SELECT %s($1)', split_part(r.generator, '(', 1))
            INTO v_count USING p_as_of;

        v_result := v_result || jsonb_build_object(r.source_type, v_count);
        v_total  := v_total + coalesce(v_count, 0);
    END LOOP;

    RETURN jsonb_build_object(
        'as_of', p_as_of,
        'total_created', v_total,
        'by_source', v_result,
        'ran_at', now());
END
$$;

REVOKE ALL ON FUNCTION platform.run_alert_engine(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.run_alert_engine(date) TO vgantt_platform_api;

INSERT INTO platform.alert_sources (source_type, module_key, audience, generator, default_thresholds, description)
VALUES
    ('subscription',   NULL, 'platform', 'platform.generate_subscription_alerts(date)',
     ARRAY[30,15,7,3], 'Tenant abonelik / lisans bitiş uyarıları'),
    ('module_license', NULL, 'platform', 'platform.generate_module_license_alerts(date)',
     ARRAY[30,15,7,3], 'Tenant bazlı modül lisansı bitiş uyarıları')
ON CONFLICT DO NOTHING;

INSERT INTO platform.schema_migrations(version) VALUES ('0005_notifications')
ON CONFLICT DO NOTHING;
