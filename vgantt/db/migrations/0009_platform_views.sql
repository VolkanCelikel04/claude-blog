-- =============================================================================
-- 0009_platform_views.sql
-- VganttAdmin reporting views + the single nightly maintenance entry point.
-- =============================================================================
\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- One row per tenant: everything the VganttAdmin tenant list shows.
-- -----------------------------------------------------------------------------
CREATE VIEW platform.v_tenant_overview AS
SELECT
    t.id                AS tenant_id,
    t.slug,
    t.name,
    t.status            AS tenant_status,
    t.created_at,
    s.id                AS subscription_id,
    s.status            AS subscription_status,
    p.code              AS plan_code,
    p.name              AS plan_name,
    s.starts_on,
    s.ends_on,
    (s.ends_on - current_date) AS days_remaining,
    CASE
        WHEN s.id IS NULL                  THEN 'none'
        WHEN s.ends_on <  current_date     THEN 'expired'
        WHEN s.ends_on <= current_date + 3  THEN 'critical'
        WHEN s.ends_on <= current_date + 7  THEN 'urgent'
        WHEN s.ends_on <= current_date + 15 THEN 'warning'
        WHEN s.ends_on <= current_date + 30 THEN 'upcoming'
        ELSE 'ok'
    END                 AS expiry_bucket,
    s.seats,
    (SELECT count(*) FROM app.users u WHERE u.tenant_id = t.id AND u.is_active) AS active_users,
    (SELECT count(*) FROM platform.tenant_modules tm
      WHERE tm.tenant_id = t.id AND tm.is_enabled)                              AS enabled_modules,
    (SELECT coalesce(sum(i.total), 0) FROM platform.invoices i
      WHERE i.tenant_id = t.id AND i.status IN ('sent','partially_paid','overdue'))
                                                                                AS open_balance,
    (SELECT coalesce(sum(i.total), 0) FROM platform.invoices i
      WHERE i.tenant_id = t.id AND i.status = 'overdue')                        AS overdue_balance,
    (SELECT max(i2.due_date) FROM platform.invoices i2
      WHERE i2.tenant_id = t.id AND i2.status = 'overdue')                      AS worst_due_date
FROM platform.tenants t
LEFT JOIN LATERAL (
    SELECT * FROM platform.subscriptions s2
    WHERE s2.tenant_id = t.id
      AND s2.status IN ('trial', 'active', 'past_due')
    ORDER BY s2.ends_on DESC
    LIMIT 1
) s ON true
LEFT JOIN platform.plans p ON p.id = s.plan_id;

-- -----------------------------------------------------------------------------
-- Module licensing matrix: what is on for whom (drives the admin toggle grid).
-- -----------------------------------------------------------------------------
CREATE VIEW platform.v_module_matrix AS
SELECT
    t.id   AS tenant_id,
    t.name AS tenant_name,
    m.key  AS module_key,
    m.name AS module_name,
    m.is_core,
    m.requires_desktop,
    coalesce(tm.is_enabled, false) AS is_enabled,
    tm.valid_until,
    tm.seat_limit,
    tm.enabled_at,
    tm.disabled_at,
    CASE
        WHEN tm.valid_until IS NULL THEN NULL
        ELSE tm.valid_until - current_date
    END AS module_days_remaining
FROM platform.tenants t
CROSS JOIN platform.modules m
LEFT JOIN platform.tenant_modules tm
       ON tm.tenant_id = t.id AND tm.module_key = m.key
WHERE m.is_active AND t.status <> 'cancelled';

-- -----------------------------------------------------------------------------
-- Collected revenue per month (admin finance chart).
-- -----------------------------------------------------------------------------
CREATE VIEW platform.v_revenue_monthly AS
SELECT
    date_trunc('month', p.paid_on)::date AS month,
    p.currency,
    sum(p.amount)  AS collected,
    count(DISTINCT p.tenant_id) AS paying_tenants
FROM platform.payments p
WHERE p.paid_on >= date_trunc('month', current_date) - interval '11 months'
GROUP BY 1, 2;

-- -----------------------------------------------------------------------------
-- Nightly maintenance: one call the scheduler makes, one transaction.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.run_daily_maintenance(p_as_of date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
DECLARE
    v_expired_subs    integer;
    v_expired_lic     integer;
    v_overdue         integer;
    v_occurrences     integer;
    v_alerts          jsonb;
BEGIN
    -- 1. Lapse subscriptions whose end date has passed.
    WITH s AS (
        UPDATE platform.subscriptions
        SET status = 'expired'
        WHERE status IN ('trial', 'active', 'past_due')
          AND ends_on < p_as_of
        RETURNING 1)
    SELECT count(*)::integer INTO v_expired_subs FROM s;

    -- 2. Suspend tenants left without a live subscription.
    UPDATE platform.tenants t
    SET status = 'suspended'
    WHERE t.status = 'active'
      AND NOT EXISTS (
            SELECT 1 FROM platform.subscriptions s
            WHERE s.tenant_id = t.id
              AND s.status IN ('trial', 'active', 'past_due'));

    -- 3. Module A / B housekeeping.
    v_expired_lic := app.expire_stale_licenses();
    v_overdue     := app.mark_overdue_receivables();
    v_occurrences := app.generate_expense_occurrences(90);

    -- 4. Warning ladder for every registered source.
    v_alerts := platform.run_alert_engine(p_as_of);

    RETURN jsonb_build_object(
        'as_of', p_as_of,
        'subscriptions_expired', v_expired_subs,
        'licenses_expired', v_expired_lic,
        'items_marked_overdue', v_overdue,
        'expense_occurrences_created', v_occurrences,
        'alerts', v_alerts);
END
$$;

REVOKE ALL ON FUNCTION platform.run_daily_maintenance(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.run_daily_maintenance(date) TO vgantt_platform_api;

INSERT INTO platform.schema_migrations(version) VALUES ('0009_platform_views')
ON CONFLICT DO NOTHING;
