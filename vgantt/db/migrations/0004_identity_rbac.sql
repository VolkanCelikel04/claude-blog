-- =============================================================================
-- 0004_identity_rbac.sql
-- Tenant users, roles, permissions, sessions.
--
-- Permission keys are namespaced by module ("<module>.<resource>.<action>") so
-- that a new module ships its permissions without touching this file.
-- =============================================================================
\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- Users (tenant members). VganttAdmin operators live in platform.admin_users.
-- -----------------------------------------------------------------------------
CREATE TABLE app.users (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    email                citext NOT NULL,
    full_name            text NOT NULL,
    password_hash        text NOT NULL,        -- argon2id; one-way, never a recoverable secret
    phone                text,
    job_title            text,
    is_active            boolean NOT NULL DEFAULT true,
    must_change_password boolean NOT NULL DEFAULT false,
    last_login_at        timestamptz,
    failed_attempts      smallint NOT NULL DEFAULT 0,
    locked_until         timestamptz,
    preferences          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_unique_per_tenant UNIQUE (tenant_id, email),
    CONSTRAINT users_email_format
        CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

COMMENT ON COLUMN app.users.password_hash IS
'Argon2id digest of the login password. Explicitly allow-listed in the vault
DDL guard (0008) because it is a one-way hash, not stored credential material.';

CREATE INDEX users_tenant_active_idx ON app.users (tenant_id) WHERE is_active;

-- Login needs to find a user before any tenant context exists, so lookups by
-- e-mail run on the platform pool. RLS still protects tenant-scoped traffic.
CREATE UNIQUE INDEX users_email_global_idx ON app.users (email, tenant_id);

-- -----------------------------------------------------------------------------
-- Roles
--   tenant_id NULL  -> system role template, visible to every tenant
--   tenant_id set   -> custom role authored by a TenantAdmin
-- -----------------------------------------------------------------------------
CREATE TABLE app.roles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid REFERENCES platform.tenants(id) ON DELETE CASCADE,
    key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
    name        text NOT NULL,
    description text,
    is_system   boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT roles_key_unique UNIQUE NULLS NOT DISTINCT (tenant_id, key),
    CONSTRAINT roles_system_has_no_tenant CHECK (NOT is_system OR tenant_id IS NULL)
);

CREATE TABLE app.permissions (
    key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.-]{2,60}$'),
    module_key  text REFERENCES platform.modules(key) ON DELETE CASCADE,
    description text NOT NULL
);

COMMENT ON COLUMN app.permissions.module_key IS
'NULL for platform-wide permissions. When set, the permission is only effective
while VganttAdmin keeps that module enabled for the tenant.';

CREATE TABLE app.role_permissions (
    role_id        uuid NOT NULL REFERENCES app.roles(id) ON DELETE CASCADE,
    permission_key text NOT NULL REFERENCES app.permissions(key) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE app.user_roles (
    user_id     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    role_id     uuid NOT NULL REFERENCES app.roles(id) ON DELETE CASCADE,
    tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    assigned_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX user_roles_tenant_idx ON app.user_roles (tenant_id);

-- -----------------------------------------------------------------------------
-- Refresh tokens (rotating). Only the SHA-256 of the token is stored.
-- -----------------------------------------------------------------------------
CREATE TABLE app.refresh_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    token_hash  bytea NOT NULL UNIQUE,
    issued_at   timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    replaced_by uuid REFERENCES app.refresh_tokens(id) ON DELETE SET NULL,
    user_agent  text,
    ip_address  inet
);

CREATE INDEX refresh_tokens_user_idx ON app.refresh_tokens (user_id)
    WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- Effective permissions of a user, module gating included.
--
-- A permission that belongs to a module the tenant no longer licenses simply
-- disappears from the result - no separate bookkeeping needed when VganttAdmin
-- switches a module off.
-- -----------------------------------------------------------------------------
CREATE VIEW app.v_user_permissions WITH (security_invoker = true) AS
SELECT
    u.id        AS user_id,
    u.tenant_id,
    p.key       AS permission_key,
    p.module_key
FROM app.users u
JOIN app.user_roles ur       ON ur.user_id = u.id
JOIN app.roles r             ON r.id = ur.role_id
JOIN app.role_permissions rp ON rp.role_id = r.id
JOIN app.permissions p       ON p.key = rp.permission_key
WHERE u.is_active
  AND (p.module_key IS NULL OR app.tenant_has_module(u.tenant_id, p.module_key));

-- -----------------------------------------------------------------------------
-- Wire the RBAC tables into the tenant isolation model
-- -----------------------------------------------------------------------------
SELECT app.apply_tenant_rls('app.users');
SELECT app.apply_tenant_rls('app.user_roles');
SELECT app.apply_tenant_rls('app.refresh_tokens');

-- app.roles is special: the NULL-tenant system templates must stay readable.
ALTER TABLE app.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_visible ON app.roles
    FOR SELECT TO vgantt_api
    USING (tenant_id IS NULL OR tenant_id = app.current_tenant_id());
CREATE POLICY roles_writable ON app.roles
    FOR ALL TO vgantt_api
    USING (tenant_id = app.current_tenant_id())
    WITH CHECK (tenant_id = app.current_tenant_id() AND NOT is_system);

CREATE OR REPLACE TRIGGER trg_roles_updated_at
    BEFORE UPDATE ON app.roles
    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Catalogue tables: readable by everyone, written by migrations only.
ALTER TABLE app.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY permissions_readable ON app.permissions
    FOR SELECT TO vgantt_api USING (true);

ALTER TABLE app.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_visible ON app.role_permissions
    FOR SELECT TO vgantt_api
    USING (EXISTS (
        SELECT 1 FROM app.roles r
        WHERE r.id = role_permissions.role_id
          AND (r.tenant_id IS NULL OR r.tenant_id = app.current_tenant_id())
    ));
CREATE POLICY role_permissions_writable ON app.role_permissions
    FOR ALL TO vgantt_api
    USING (EXISTS (
        SELECT 1 FROM app.roles r
        WHERE r.id = role_permissions.role_id AND r.tenant_id = app.current_tenant_id()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM app.roles r
        WHERE r.id = role_permissions.role_id AND r.tenant_id = app.current_tenant_id()
    ));

GRANT SELECT ON app.permissions, app.roles, app.role_permissions TO vgantt_api;
GRANT INSERT, UPDATE, DELETE ON app.roles, app.role_permissions TO vgantt_api;
GRANT SELECT ON app.v_user_permissions TO vgantt_api, vgantt_platform_api;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON app.permissions, app.roles, app.role_permissions TO vgantt_platform_api;

INSERT INTO platform.schema_migrations(version) VALUES ('0004_identity_rbac')
ON CONFLICT DO NOTHING;
