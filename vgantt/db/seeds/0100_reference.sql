-- =============================================================================
-- 0100_reference.sql  -- Required reference data. Safe to re-run.
-- Core permissions, system role templates, commercial plans.
-- =============================================================================
\set ON_ERROR_STOP on

-- ------------------------------------------------------------- permissions
-- module_key NULL = always available, independent of module licensing.
INSERT INTO app.permissions (key, module_key, description) VALUES
    ('users.read',          NULL, 'Kullanıcıları görüntüleme'),
    ('users.manage',        NULL, 'Kullanıcı ekleme, düzenleme, pasife alma'),
    ('roles.manage',        NULL, 'Rol ve yetki yönetimi'),
    ('settings.manage',     NULL, 'Şirket ayarlarını düzenleme'),
    ('notifications.read',  NULL, 'Bildirimleri görüntüleme'),
    ('dashboard.view',      NULL, 'Ana paneli görüntüleme'),
    ('audit.read',          NULL, 'İşlem geçmişini görüntüleme')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------ system roles
INSERT INTO app.roles (id, tenant_id, key, name, description, is_system) VALUES
    ('11111111-1111-4111-8111-111111111111', NULL, 'tenant_admin',
     'Şirket Yöneticisi', 'Şirketin tüm modüllerine ve kullanıcı yönetimine tam erişim.', true),
    ('22222222-2222-4222-8222-222222222222', NULL, 'tenant_user',
     'Standart Kullanıcı', 'Lisanslı modülleri kullanır, kullanıcı yönetimi yapamaz.', true),
    ('33333333-3333-4333-8333-333333333333', NULL, 'finance_manager',
     'Finans Sorumlusu', 'Finans modülünde tam yetki, diğer modüllerde okuma.', true),
    ('44444444-4444-4444-8444-444444444444', NULL, 'viewer',
     'İzleyici', 'Yalnızca okuma yetkisi.', true)
ON CONFLICT (id) DO NOTHING;

-- tenant_admin: everything that exists
INSERT INTO app.role_permissions (role_id, permission_key)
SELECT '11111111-1111-4111-8111-111111111111', key FROM app.permissions
ON CONFLICT DO NOTHING;

-- tenant_user: read everywhere + day-to-day writes, no admin surface
INSERT INTO app.role_permissions (role_id, permission_key)
SELECT '22222222-2222-4222-8222-222222222222', key FROM app.permissions
WHERE key IN ('dashboard.view', 'notifications.read', 'users.read',
              'licenses.read', 'licenses.write', 'licenses.renew',
              'finance.read', 'vault.use')
ON CONFLICT DO NOTHING;

-- finance_manager
INSERT INTO app.role_permissions (role_id, permission_key)
SELECT '33333333-3333-4333-8333-333333333333', key FROM app.permissions
WHERE key IN ('dashboard.view', 'notifications.read', 'licenses.read',
              'finance.read', 'finance.expense.write', 'finance.invoice.write',
              'finance.payment.write', 'finance.report', 'vault.use')
ON CONFLICT DO NOTHING;

-- viewer
INSERT INTO app.role_permissions (role_id, permission_key)
SELECT '44444444-4444-4444-8444-444444444444', key FROM app.permissions
WHERE key IN ('dashboard.view', 'notifications.read', 'licenses.read', 'finance.read')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------- plans
INSERT INTO app.permissions (key, module_key, description) VALUES
    ('vault.use', 'vault', 'Yerel şifre kasasını açma ve kullanma')
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform.plans (id, code, name, description, billing_period, price, max_users, trial_days) VALUES
    ('aaaaaaa1-0000-4000-8000-000000000001', 'starter', 'Başlangıç',
     'Tek modül, 5 kullanıcı.', 'yearly', 12000.00, 5, 14),
    ('aaaaaaa1-0000-4000-8000-000000000002', 'professional', 'Profesyonel',
     'Tüm çekirdek modüller, 25 kullanıcı.', 'yearly', 36000.00, 25, 14),
    ('aaaaaaa1-0000-4000-8000-000000000003', 'enterprise', 'Kurumsal',
     'Sınırsız kullanıcı, öncelikli destek.', 'yearly', 96000.00, NULL, 30)
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.plan_modules (plan_id, module_key) VALUES
    ('aaaaaaa1-0000-4000-8000-000000000001', 'licenses'),
    ('aaaaaaa1-0000-4000-8000-000000000002', 'licenses'),
    ('aaaaaaa1-0000-4000-8000-000000000002', 'finance'),
    ('aaaaaaa1-0000-4000-8000-000000000002', 'vault'),
    ('aaaaaaa1-0000-4000-8000-000000000003', 'licenses'),
    ('aaaaaaa1-0000-4000-8000-000000000003', 'finance'),
    ('aaaaaaa1-0000-4000-8000-000000000003', 'vault')
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------- default policies
-- Global warning ladders. A tenant row in platform.alert_policies overrides these.
INSERT INTO platform.alert_policies (tenant_id, source_type, thresholds, channels) VALUES
    (NULL, 'subscription',      ARRAY[30, 15, 7, 3], ARRAY['in_app', 'email']),
    (NULL, 'module_license',    ARRAY[30, 15, 7, 3], ARRAY['in_app']),
    (NULL, 'license',           ARRAY[30, 15, 7, 3], ARRAY['in_app', 'email']),
    (NULL, 'receivable',        ARRAY[3],            ARRAY['in_app', 'email']),
    (NULL, 'recurring_expense', ARRAY[7, 3],         ARRAY['in_app'])
ON CONFLICT DO NOTHING;
