-- =============================================================================
-- 0101_demo.sql  -- Optional demo dataset.
-- Three tenants with deliberately different expiry distances so the 30/15/7/3
-- ladder can be observed end to end. Dev/staging only.
--
-- All demo logins use the password:  Vgantt2026!
-- =============================================================================
\set ON_ERROR_STOP on

-- VganttAdmin operator
INSERT INTO platform.admin_users (id, email, full_name, password_hash, role) VALUES
    ('0d000000-0000-4000-8000-00000000000a', 'admin@vgantt.local', 'Sistem Yöneticisi',
     crypt('Vgantt2026!', gen_salt('bf', 12)), 'super_admin')
ON CONFLICT (email) DO NOTHING;

-- ------------------------------------------------------------------ tenants
INSERT INTO platform.tenants (id, slug, name, legal_name, status, activated_at) VALUES
    ('0c000000-0000-4000-8000-000000000001', 'acme-insaat',    'Acme İnşaat',
     'Acme İnşaat Taahhüt A.Ş.', 'active', now()),
    ('0c000000-0000-4000-8000-000000000002', 'beta-yazilim',   'Beta Yazılım',
     'Beta Yazılım Ltd. Şti.', 'active', now()),
    ('0c000000-0000-4000-8000-000000000003', 'gamma-lojistik', 'Gamma Lojistik',
     'Gamma Lojistik A.Ş.', 'trial', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform.tenant_contacts (tenant_id, contact_type, full_name, email, phone, is_primary) VALUES
    ('0c000000-0000-4000-8000-000000000001', 'primary', 'Mehmet Yılmaz', 'mehmet@acme.example', '+90 532 000 0001', true),
    ('0c000000-0000-4000-8000-000000000002', 'primary', 'Ayşe Demir',   'ayse@beta.example',   '+90 532 000 0002', true),
    ('0c000000-0000-4000-8000-000000000003', 'primary', 'Can Kaya',     'can@gamma.example',   '+90 532 000 0003', true)
ON CONFLICT DO NOTHING;

-- Subscriptions land on 7 / 30 / 3 days out: one tenant per warning band.
INSERT INTO platform.subscriptions (id, tenant_id, plan_id, status, starts_on, ends_on, seats) VALUES
    ('0b000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001',
     'aaaaaaa1-0000-4000-8000-000000000003', 'active', current_date - 358, current_date + 7,  40),
    ('0b000000-0000-4000-8000-000000000002', '0c000000-0000-4000-8000-000000000002',
     'aaaaaaa1-0000-4000-8000-000000000002', 'active', current_date - 335, current_date + 30, 25),
    ('0b000000-0000-4000-8000-000000000003', '0c000000-0000-4000-8000-000000000003',
     'aaaaaaa1-0000-4000-8000-000000000001', 'trial',  current_date - 11,  current_date + 3,  5)
ON CONFLICT (id) DO NOTHING;

-- Module licensing: exactly what VganttAdmin toggles in the panel.
INSERT INTO platform.tenant_modules (tenant_id, module_key, is_enabled, valid_until, updated_by) VALUES
    ('0c000000-0000-4000-8000-000000000001', 'licenses', true,  NULL, '0d000000-0000-4000-8000-00000000000a'),
    ('0c000000-0000-4000-8000-000000000001', 'finance',  true,  NULL, '0d000000-0000-4000-8000-00000000000a'),
    ('0c000000-0000-4000-8000-000000000001', 'vault',    true,  NULL, '0d000000-0000-4000-8000-00000000000a'),
    ('0c000000-0000-4000-8000-000000000002', 'licenses', true,  NULL, '0d000000-0000-4000-8000-00000000000a'),
    ('0c000000-0000-4000-8000-000000000002', 'finance',  true,  current_date + 15, '0d000000-0000-4000-8000-00000000000a'),
    -- Beta has NOT bought the vault: the menu item will not render for them.
    ('0c000000-0000-4000-8000-000000000002', 'vault',    false, NULL, '0d000000-0000-4000-8000-00000000000a'),
    ('0c000000-0000-4000-8000-000000000003', 'licenses', true,  NULL, '0d000000-0000-4000-8000-00000000000a'),
    ('0c000000-0000-4000-8000-000000000003', 'finance',  false, NULL, '0d000000-0000-4000-8000-00000000000a'),
    ('0c000000-0000-4000-8000-000000000003', 'vault',    false, NULL, '0d000000-0000-4000-8000-00000000000a')
ON CONFLICT (tenant_id, module_key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled;

-- -------------------------------------------------------------------- users
INSERT INTO app.users (id, tenant_id, email, full_name, password_hash, job_title) VALUES
    ('0a000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001',
     'admin@acme.example', 'Mehmet Yılmaz', crypt('Vgantt2026!', gen_salt('bf', 12)), 'Genel Müdür'),
    ('0a000000-0000-4000-8000-000000000002', '0c000000-0000-4000-8000-000000000001',
     'finans@acme.example', 'Zeynep Arslan', crypt('Vgantt2026!', gen_salt('bf', 12)), 'Finans Müdürü'),
    ('0a000000-0000-4000-8000-000000000003', '0c000000-0000-4000-8000-000000000002',
     'admin@beta.example', 'Ayşe Demir', crypt('Vgantt2026!', gen_salt('bf', 12)), 'Kurucu'),
    ('0a000000-0000-4000-8000-000000000004', '0c000000-0000-4000-8000-000000000003',
     'admin@gamma.example', 'Can Kaya', crypt('Vgantt2026!', gen_salt('bf', 12)), 'Operasyon Müdürü')
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.user_roles (user_id, role_id, tenant_id) VALUES
    ('0a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '0c000000-0000-4000-8000-000000000001'),
    ('0a000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', '0c000000-0000-4000-8000-000000000001'),
    ('0a000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '0c000000-0000-4000-8000-000000000002'),
    ('0a000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', '0c000000-0000-4000-8000-000000000003')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------- MODULE A: licences
INSERT INTO app.licenses (tenant_id, name, license_type, vendor, end_date, cost, auto_renew, account_reference) VALUES
    ('0c000000-0000-4000-8000-000000000001', 'acme.com.tr domain',     'domain',          'Natro',       current_date + 3,  850.00,  true,  'NTR-884512'),
    ('0c000000-0000-4000-8000-000000000001', 'Wildcard SSL',           'ssl_certificate', 'Sectigo',     current_date + 7,  2400.00, false, 'SEC-11290'),
    ('0c000000-0000-4000-8000-000000000001', 'AutoCAD LT (10 kul.)',   'software',        'Autodesk',    current_date + 15, 48000.00,true,  'ADSK-772'),
    ('0c000000-0000-4000-8000-000000000001', 'Microsoft 365 Business', 'subscription',    'Microsoft',   current_date + 30, 31200.00,true,  'MS-90211'),
    ('0c000000-0000-4000-8000-000000000001', 'Sunucu bakım anlaşması', 'other',           'Vargonen',    current_date - 2,  9600.00, false, 'VRG-5512'),
    ('0c000000-0000-4000-8000-000000000001', 'ISO 9001 belgesi',       'certification',   'TÜV',         current_date + 210,15000.00,false, 'TUV-2231'),
    ('0c000000-0000-4000-8000-000000000002', 'beta.dev domain',        'domain',          'Cloudflare',  current_date + 3,  420.00,  true,  'CF-33019'),
    ('0c000000-0000-4000-8000-000000000002', 'JetBrains All Products', 'software',        'JetBrains',   current_date + 30, 28000.00,true,  'JB-88120'),
    ('0c000000-0000-4000-8000-000000000003', 'Filo takip yazılımı',    'subscription',    'Arvento',     current_date + 15, 64000.00,true,  'ARV-4410')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------ MODULE B: finance
INSERT INTO app.finance_categories (id, tenant_id, name, kind, color) VALUES
    ('0e000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001', 'Kira',       'expense', '#1e3a5f'),
    ('0e000000-0000-4000-8000-000000000002', '0c000000-0000-4000-8000-000000000001', 'Personel',   'expense', '#b8860b'),
    ('0e000000-0000-4000-8000-000000000003', '0c000000-0000-4000-8000-000000000001', 'Yazılım',    'expense', '#2d6a4f'),
    ('0e000000-0000-4000-8000-000000000004', '0c000000-0000-4000-8000-000000000001', 'Danışmanlık','income',  '#d4740e')
ON CONFLICT DO NOTHING;

INSERT INTO app.recurring_expenses (tenant_id, title, category_id, vendor, amount, period, day_of_month, start_date) VALUES
    ('0c000000-0000-4000-8000-000000000001', 'Ofis kirası', '0e000000-0000-4000-8000-000000000001', 'Kaya Emlak', 85000.00, 'monthly', 5,  current_date - 400),
    ('0c000000-0000-4000-8000-000000000001', 'Muhasebe hizmeti', NULL, 'Şen Mali Müşavirlik',                     18000.00, 'monthly', 15, current_date - 400),
    ('0c000000-0000-4000-8000-000000000001', 'Sunucu / hosting', '0e000000-0000-4000-8000-000000000003', 'Vargonen', 7400.00, 'monthly', 1, current_date - 400),
    ('0c000000-0000-4000-8000-000000000001', 'Araç sigortası', NULL, 'Anadolu Sigorta',                            42000.00, 'yearly',  NULL, current_date - 300)
ON CONFLICT DO NOTHING;

INSERT INTO app.customers (id, tenant_id, name, email, phone) VALUES
    ('0f000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001', 'Yıldız Holding',   'muhasebe@yildiz.example', '+90 212 000 0011'),
    ('0f000000-0000-4000-8000-000000000002', '0c000000-0000-4000-8000-000000000001', 'Deniz Gayrimenkul','finans@deniz.example',    '+90 216 000 0022'),
    ('0f000000-0000-4000-8000-000000000003', '0c000000-0000-4000-8000-000000000001', 'Kuzey Enerji',     'odeme@kuzey.example',     '+90 312 000 0033')
ON CONFLICT DO NOTHING;

INSERT INTO app.customer_invoices (id, tenant_id, customer_id, invoice_no, description, issue_date, due_date, amount) VALUES
    ('0f100000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001',
     'FTR-2026-0141', 'Hakediş 4', current_date - 45, current_date - 15, 420000.00),   -- 15 gün gecikmiş
    ('0f100000-0000-4000-8000-000000000002', '0c000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002',
     'FTR-2026-0152', 'Proje danışmanlığı', current_date - 27, current_date + 3, 96000.00),  -- 3 gün kala
    ('0f100000-0000-4000-8000-000000000003', '0c000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000003',
     'FTR-2026-0158', 'Keşif ve etüt', current_date - 10, current_date, 64000.00),          -- bugün vadesi
    ('0f100000-0000-4000-8000-000000000004', '0c000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000001',
     'FTR-2026-0160', 'Hakediş 5', current_date - 5, current_date + 25, 310000.00),
    ('0f100000-0000-4000-8000-000000000005', '0c000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002',
     'FTR-2026-0133', 'Tadilat işleri', current_date - 70, current_date - 40, 178000.00)    -- kısmi ödeme
ON CONFLICT DO NOTHING;

INSERT INTO app.customer_payments (tenant_id, invoice_id, amount, paid_on, method, reference) VALUES
    ('0c000000-0000-4000-8000-000000000001', '0f100000-0000-4000-8000-000000000005', 100000.00, current_date - 30, 'bank_transfer', 'EFT-88213'),
    ('0c000000-0000-4000-8000-000000000001', '0f100000-0000-4000-8000-000000000004',  50000.00, current_date - 2,  'bank_transfer', 'EFT-90114')
ON CONFLICT DO NOTHING;

-- Platform-side billing: what VganttAdmin invoices Acme.
INSERT INTO platform.invoices (tenant_id, subscription_id, invoice_no, issue_date, due_date, subtotal, status) VALUES
    ('0c000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001', 'VG-2026-0001', current_date - 360, current_date - 345, 96000.00, 'sent'),
    ('0c000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-000000000002', 'VG-2026-0002', current_date - 335, current_date - 320, 36000.00, 'sent'),
    ('0c000000-0000-4000-8000-000000000003', '0b000000-0000-4000-8000-000000000003', 'VG-2026-0003', current_date - 5,   current_date + 10,  12000.00, 'sent')
ON CONFLICT (invoice_no) DO NOTHING;

INSERT INTO platform.payments (tenant_id, invoice_id, amount, paid_on, method, recorded_by)
SELECT i.tenant_id, i.id, i.total, current_date - 340, 'bank_transfer', '0d000000-0000-4000-8000-00000000000a'
FROM platform.invoices i WHERE i.invoice_no IN ('VG-2026-0001', 'VG-2026-0002')
ON CONFLICT DO NOTHING;

-- Materialise expense occurrences and run the warning ladder once.
SELECT app.generate_expense_occurrences(120);
SELECT platform.run_daily_maintenance();
