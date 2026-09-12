import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformDb } from '../../common/database/platform-db.service';
import { PasswordService } from '../../common/auth/password.service';
import { AuditService } from '../../common/audit/audit.service';
import { LicensingService } from '../../common/licensing/licensing.service';
import { SessionService } from '../../common/auth/session.service';
import { CreateTenantDto, UpdateTenantDto } from './platform-admin.dto';

const TENANT_ADMIN_ROLE_ID = '11111111-1111-4111-8111-111111111111';

/**
 * VganttAdmin tenant management.
 *
 * Runs on the platform pool (BYPASSRLS) because it legitimately works across
 * tenants. Every method here is reachable only behind @RequireAudience('platform').
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly db: PlatformDb,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly licensing: LicensingService,
    private readonly sessions: SessionService,
  ) {}

  /** The admin tenant list: status, plan, days remaining, open balance. */
  async list(params: { search?: string; status?: string; expiringWithin?: number }) {
    return this.db.query(
      `SELECT * FROM platform.v_tenant_overview
        WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR slug::text ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR tenant_status::text = $2)
          AND ($3::int  IS NULL OR (days_remaining IS NOT NULL AND days_remaining <= $3))
        ORDER BY
          CASE expiry_bucket
            WHEN 'expired'  THEN 0 WHEN 'critical' THEN 1 WHEN 'urgent' THEN 2
            WHEN 'warning'  THEN 3 WHEN 'upcoming' THEN 4 ELSE 5 END,
          days_remaining NULLS LAST,
          name`,
      [params.search ?? null, params.status ?? null, params.expiringWithin ?? null],
    );
  }

  async findOne(tenantId: string) {
    const tenant = await this.db.one(
      `SELECT * FROM platform.v_tenant_overview WHERE tenant_id = $1`,
      [tenantId],
    );
    if (!tenant) throw new NotFoundException('Şirket bulunamadı.');

    const [contacts, modules, subscriptions, invoices, users] = await Promise.all([
      this.db.query(`SELECT * FROM platform.tenant_contacts WHERE tenant_id = $1`, [tenantId]),
      this.db.query(
        `SELECT * FROM platform.v_module_matrix WHERE tenant_id = $1 ORDER BY module_key`,
        [tenantId],
      ),
      this.db.query(
        `SELECT s.*, p.name AS plan_name, p.code AS plan_code
           FROM platform.subscriptions s JOIN platform.plans p ON p.id = s.plan_id
          WHERE s.tenant_id = $1 ORDER BY s.ends_on DESC`,
        [tenantId],
      ),
      this.db.query(
        `SELECT i.*, coalesce(sum(p.amount), 0)::text AS paid_amount
           FROM platform.invoices i
           LEFT JOIN platform.payments p ON p.invoice_id = i.id
          WHERE i.tenant_id = $1
          GROUP BY i.id ORDER BY i.issue_date DESC LIMIT 24`,
        [tenantId],
      ),
      this.db.query(
        `SELECT id, email::text AS email, full_name, is_active, last_login_at
           FROM app.users WHERE tenant_id = $1 ORDER BY full_name`,
        [tenantId],
      ),
    ]);

    return { ...tenant, contacts, modules, subscriptions, invoices, users };
  }

  /**
   * Creating a tenant is one transaction: company, contact, subscription,
   * module licences and the first TenantAdmin. A half-created tenant (a company
   * nobody can log into) is worse than no tenant at all.
   */
  async create(dto: CreateTenantDto) {
    const strengthIssues = this.passwords.validateStrength(dto.adminPassword, 10);
    if (strengthIssues.length > 0) {
      throw new BadRequestException({ error: 'WEAK_PASSWORD', messages: strengthIssues });
    }

    const passwordHash = await this.passwords.hash(dto.adminPassword);

    const created = await this.db.transaction(async (db) => {
      const tenant = await db.one<{ id: string }>(
        `INSERT INTO platform.tenants (slug, name, legal_name, tax_office, tax_number, status, activated_at)
         VALUES ($1, $2, $3, $4, $5, 'active', now())
         RETURNING id`,
        [dto.slug, dto.name, dto.legalName ?? null, dto.taxOffice ?? null, dto.taxNumber ?? null],
      );
      const tenantId = tenant!.id;

      await db.execute(
        `INSERT INTO platform.tenant_contacts (tenant_id, contact_type, full_name, email, phone, is_primary)
         VALUES ($1, 'primary', $2, $3, $4, true)`,
        [tenantId, dto.contactName, dto.contactEmail, dto.contactPhone ?? null],
      );

      const subscription = await db.one<{ id: string }>(
        `INSERT INTO platform.subscriptions (tenant_id, plan_id, status, starts_on, ends_on, seats)
         VALUES ($1, $2, 'active', current_date, $3, coalesce($4, 5))
         RETURNING id`,
        [tenantId, dto.planId, dto.endsOn, dto.seats ?? null],
      );

      // Modules: explicit list wins, otherwise everything the plan bundles.
      if (dto.modules?.length) {
        await db.execute(
          `INSERT INTO platform.tenant_modules (tenant_id, module_key, is_enabled)
           SELECT $1, unnest($2::text[]), true
           ON CONFLICT (tenant_id, module_key) DO UPDATE SET is_enabled = true`,
          [tenantId, dto.modules],
        );
      } else {
        await db.execute(
          `INSERT INTO platform.tenant_modules (tenant_id, module_key, is_enabled)
           SELECT $1, pm.module_key, true
             FROM platform.plan_modules pm WHERE pm.plan_id = $2
           ON CONFLICT (tenant_id, module_key) DO UPDATE SET is_enabled = true`,
          [tenantId, dto.planId],
        );
      }

      const user = await db.one<{ id: string }>(
        `INSERT INTO app.users (tenant_id, email, full_name, password_hash, must_change_password)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id`,
        [tenantId, dto.adminEmail, dto.adminFullName, passwordHash],
      );

      await db.execute(
        `INSERT INTO app.user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`,
        [user!.id, TENANT_ADMIN_ROLE_ID, tenantId],
      );

      return { tenantId, subscriptionId: subscription!.id, adminUserId: user!.id };
    });

    await this.audit.record({
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: created.tenantId,
      tenantId: created.tenantId,
      after: { slug: dto.slug, name: dto.name, endsOn: dto.endsOn },
    });

    return created;
  }

  async update(tenantId: string, dto: UpdateTenantDto) {
    const before = await this.db.one(`SELECT * FROM platform.tenants WHERE id = $1`, [tenantId]);
    if (!before) throw new NotFoundException('Şirket bulunamadı.');

    const after = await this.db.one(
      `UPDATE platform.tenants SET
           name = coalesce($2, name),
           legal_name = coalesce($3, legal_name),
           tax_office = coalesce($4, tax_office),
           tax_number = coalesce($5, tax_number),
           address_line = coalesce($6, address_line),
           city = coalesce($7, city),
           notes = coalesce($8, notes),
           status = coalesce($9::platform.tenant_status, status),
           deactivated_at = CASE WHEN $9 = 'cancelled' THEN now() ELSE deactivated_at END
       WHERE id = $1
       RETURNING *`,
      [
        tenantId, dto.name ?? null, dto.legalName ?? null, dto.taxOffice ?? null,
        dto.taxNumber ?? null, dto.address ?? null, dto.city ?? null, dto.notes ?? null,
        dto.status ?? null,
      ],
    );

    // A status change alters what users may do: drop the cached sessions.
    this.sessions.invalidateTenant(tenantId);
    this.licensing.invalidate(tenantId);

    await this.audit.record({
      action: 'tenant.updated',
      entityType: 'tenant',
      entityId: tenantId,
      tenantId,
      before,
      after,
    });

    return after;
  }

  /** "Pasife alma": keeps the data, blocks the logins. */
  async deactivate(tenantId: string, reason?: string) {
    const result = await this.db.transaction(async (db) => {
      const tenant = await db.one(
        `UPDATE platform.tenants
            SET status = 'suspended', deactivated_at = now(),
                notes = coalesce(notes, '') || E'\n[' || now()::date || '] Pasife alındı: ' || coalesce($2, '-')
          WHERE id = $1 RETURNING id, name, status::text AS status`,
        [tenantId, reason ?? null],
      );
      if (!tenant) throw new NotFoundException('Şirket bulunamadı.');

      // Revoke live sessions so access stops now, not at token expiry.
      await db.execute(
        `UPDATE app.refresh_tokens SET revoked_at = now()
          WHERE tenant_id = $1 AND revoked_at IS NULL`,
        [tenantId],
      );
      return tenant;
    });

    this.sessions.invalidateTenant(tenantId);
    this.licensing.invalidate(tenantId);

    await this.audit.record({
      action: 'tenant.deactivated',
      entityType: 'tenant',
      entityId: tenantId,
      tenantId,
      after: { reason },
    });

    return result;
  }

  async reactivate(tenantId: string) {
    const result = await this.db.one(
      `UPDATE platform.tenants SET status = 'active', deactivated_at = NULL
        WHERE id = $1 RETURNING id, name, status::text AS status`,
      [tenantId],
    );
    if (!result) throw new NotFoundException('Şirket bulunamadı.');

    this.sessions.invalidateTenant(tenantId);
    await this.audit.record({
      action: 'tenant.reactivated', entityType: 'tenant', entityId: tenantId, tenantId,
    });
    return result;
  }

  /** Operator dashboard counters. */
  async dashboard() {
    const [counts] = await this.db.query<Record<string, string>>(
      `SELECT
         count(*) FILTER (WHERE tenant_status = 'active')::text     AS active_tenants,
         count(*) FILTER (WHERE tenant_status = 'trial')::text      AS trial_tenants,
         count(*) FILTER (WHERE tenant_status = 'suspended')::text  AS suspended_tenants,
         count(*) FILTER (WHERE expiry_bucket IN ('critical','urgent'))::text AS expiring_soon,
         count(*) FILTER (WHERE expiry_bucket = 'expired')::text    AS expired,
         coalesce(sum(open_balance), 0)::text                       AS open_balance,
         coalesce(sum(overdue_balance), 0)::text                    AS overdue_balance
       FROM platform.v_tenant_overview`,
    );

    const [revenue, expiring, unreadAlerts] = await Promise.all([
      this.db.query(
        `SELECT to_char(month, 'YYYY-MM') AS month, collected::text, paying_tenants
           FROM platform.v_revenue_monthly ORDER BY month`,
      ),
      this.db.query(
        `SELECT tenant_id, name, slug, plan_name, ends_on, days_remaining, expiry_bucket
           FROM platform.v_tenant_overview
          WHERE days_remaining IS NOT NULL AND days_remaining <= 30
          ORDER BY days_remaining LIMIT 20`,
      ),
      this.db.query(
        `SELECT id, tenant_id, severity::text AS severity, category, title, body,
                due_date, threshold_days, created_at
           FROM platform.admin_notifications
          WHERE NOT is_read
          ORDER BY created_at DESC LIMIT 50`,
      ),
    ]);

    return {
      counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])),
      revenue: revenue.map((r) => ({
        month: r.month as string,
        collected: Number(r.collected),
        payingTenants: Number(r.paying_tenants),
      })),
      expiringTenants: expiring,
      alerts: unreadAlerts,
    };
  }
}
