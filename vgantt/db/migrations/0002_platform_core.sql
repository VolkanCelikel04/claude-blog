-- =============================================================================
-- 0002_platform_core.sql
-- Tenants, tenant contacts, VganttAdmin operators, audit trail.
-- =============================================================================
\set ON_ERROR_STOP on

CREATE TYPE platform.tenant_status AS ENUM ('trial', 'active', 'suspended', 'cancelled');
CREATE TYPE platform.contact_type  AS ENUM ('primary', 'billing', 'technical');
CREATE TYPE platform.admin_role    AS ENUM ('super_admin', 'operations', 'billing', 'support');
CREATE TYPE platform.actor_type    AS ENUM ('platform_admin', 'tenant_user', 'system');

-- -----------------------------------------------------------------------------
-- Tenants
-- -----------------------------------------------------------------------------
CREATE TABLE platform.tenants (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            citext NOT NULL UNIQUE
                    CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
    name            text NOT NULL CHECK (length(btrim(name)) > 0),
    legal_name      text,
    tax_office      text,
    tax_number      text,
    status          platform.tenant_status NOT NULL DEFAULT 'trial',
    country_code    char(2) NOT NULL DEFAULT 'TR',
    timezone        text NOT NULL DEFAULT 'Europe/Istanbul',
    currency        char(3) NOT NULL DEFAULT 'TRY',
    locale          text NOT NULL DEFAULT 'tr-TR',
    address_line     text,
    city            text,
    notes           text,
    settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    activated_at    timestamptz,
    deactivated_at  timestamptz,
    CONSTRAINT tenants_deactivation_consistent
        CHECK (status <> 'cancelled' OR deactivated_at IS NOT NULL)
);

COMMENT ON TABLE platform.tenants IS 'One row per customer company. The root of every isolation boundary.';
COMMENT ON COLUMN platform.tenants.slug IS 'URL/sub-domain safe identifier, e.g. acme-insaat.';

CREATE INDEX tenants_status_idx ON platform.tenants (status) WHERE status <> 'cancelled';

CREATE OR REPLACE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON platform.tenants
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- A tenant may read only its own row; writes are platform-only.
ALTER TABLE platform.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_reads_self ON platform.tenants
    FOR SELECT TO vgantt_api
    USING (id = app.current_tenant_id());

-- -----------------------------------------------------------------------------
-- Tenant contacts
-- -----------------------------------------------------------------------------
CREATE TABLE platform.tenant_contacts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    contact_type  platform.contact_type NOT NULL DEFAULT 'primary',
    full_name     text NOT NULL,
    email         citext,
    phone         text,
    title         text,
    is_primary    boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenant_contacts_email_format
        CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

-- At most one primary contact per tenant.
CREATE UNIQUE INDEX tenant_contacts_one_primary_idx
    ON platform.tenant_contacts (tenant_id) WHERE is_primary;
CREATE INDEX tenant_contacts_tenant_idx ON platform.tenant_contacts (tenant_id);

CREATE OR REPLACE TRIGGER trg_tenant_contacts_updated_at
    BEFORE UPDATE ON platform.tenant_contacts
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE platform.tenant_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_reads_own_contacts ON platform.tenant_contacts
    FOR SELECT TO vgantt_api
    USING (tenant_id = app.current_tenant_id());

-- -----------------------------------------------------------------------------
-- VganttAdmin operators
--
-- Deliberately NOT in app.users: platform operators are not tenant members and
-- must never be reachable through a tenant-scoped query.
-- -----------------------------------------------------------------------------
CREATE TABLE platform.admin_users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           citext NOT NULL UNIQUE,
    full_name       text NOT NULL,
    password_hash   text NOT NULL,           -- argon2id, one-way. Never a reversible secret.
    role            platform.admin_role NOT NULL DEFAULT 'support',
    is_active       boolean NOT NULL DEFAULT true,
    mfa_enabled     boolean NOT NULL DEFAULT false,
    last_login_at   timestamptz,
    failed_attempts smallint NOT NULL DEFAULT 0,
    locked_until    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_admin_users_updated_at
    BEFORE UPDATE ON platform.admin_users
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- The tenant API role has no grant at all on this table (see 0011_grants.sql).

-- -----------------------------------------------------------------------------
-- Audit trail (append-only)
-- -----------------------------------------------------------------------------
CREATE TABLE audit.activity_log (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    actor_type   platform.actor_type NOT NULL,
    actor_id     uuid,
    actor_label  text,
    tenant_id    uuid REFERENCES platform.tenants(id) ON DELETE SET NULL,
    action       text NOT NULL,              -- tenant.created, module.enabled, invoice.paid ...
    entity_type  text,
    entity_id    text,
    before_state jsonb,
    after_state  jsonb,
    ip_address   inet,
    user_agent   text,
    request_id   text
);

CREATE INDEX activity_log_tenant_time_idx ON audit.activity_log (tenant_id, occurred_at DESC);
CREATE INDEX activity_log_action_idx      ON audit.activity_log (action, occurred_at DESC);
CREATE INDEX activity_log_entity_idx      ON audit.activity_log (entity_type, entity_id);

-- Append-only: no UPDATE/DELETE grant is ever issued, and a rule makes the
-- intent explicit for anyone reading the schema.
CREATE OR REPLACE FUNCTION audit.block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit.activity_log is append-only' USING ERRCODE = '42501';
END
$$;

CREATE OR REPLACE TRIGGER trg_activity_log_immutable
    BEFORE UPDATE OR DELETE ON audit.activity_log
    FOR EACH ROW EXECUTE FUNCTION audit.block_mutation();

ALTER TABLE audit.activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.activity_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_reads_own_audit ON audit.activity_log
    FOR SELECT TO vgantt_api
    USING (tenant_id = app.current_tenant_id());
CREATE POLICY tenant_appends_own_audit ON audit.activity_log
    FOR INSERT TO vgantt_api
    WITH CHECK (tenant_id = app.current_tenant_id());

INSERT INTO platform.schema_migrations(version) VALUES ('0002_platform_core')
ON CONFLICT DO NOTHING;
