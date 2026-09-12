import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformDb } from '../../common/database/platform-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { LicensingService } from '../../common/licensing/licensing.service';
import { SessionService } from '../../common/auth/session.service';
import { RequestContextStore } from '../../common/context/request-context';
import { ToggleModuleDto } from './platform-admin.dto';

/**
 * The one-click module switch.
 *
 * Flipping is_enabled has three simultaneous effects and needs no other code:
 *   1. the tenant's menu loses the item  (GET /auth/me stops listing it)
 *   2. the module's API routes return 402 (ModuleLicenseGuard)
 *   3. the module's rows become invisible (RLS policy calls tenant_has_module)
 *
 * Data is never deleted, so switching back restores everything.
 */
@Injectable()
export class ModuleLicensingService {
  constructor(
    private readonly db: PlatformDb,
    private readonly audit: AuditService,
    private readonly licensing: LicensingService,
    private readonly sessions: SessionService,
  ) {}

  async catalogue() {
    return this.db.query(
      `SELECT key, name, description, category, icon, is_core, requires_desktop,
              stores_server_data, sort_order,
              (SELECT count(*) FROM platform.tenant_modules tm
                WHERE tm.module_key = m.key AND tm.is_enabled)::int AS active_tenants
         FROM platform.modules m
        WHERE is_active
        ORDER BY sort_order, name`,
    );
  }

  /** The full tenant x module grid the admin UI renders as toggles. */
  async matrix(tenantId?: string) {
    return this.db.query(
      `SELECT * FROM platform.v_module_matrix
        WHERE ($1::uuid IS NULL OR tenant_id = $1)
        ORDER BY tenant_name, module_key`,
      [tenantId ?? null],
    );
  }

  async toggle(tenantId: string, moduleKey: string, dto: ToggleModuleDto) {
    const ctx = RequestContextStore.get();

    const module = await this.db.one<{ key: string; name: string; is_core: boolean }>(
      `SELECT key, name, is_core FROM platform.modules WHERE key = $1 AND is_active`,
      [moduleKey],
    );
    if (!module) throw new NotFoundException(`"${moduleKey}" modülü bulunamadı.`);

    if (module.is_core && !dto.enabled) {
      throw new BadRequestException(
        `"${module.name}" çekirdek bir modüldür ve kapatılamaz.`,
      );
    }

    const tenantExists = await this.db.one(`SELECT id FROM platform.tenants WHERE id = $1`, [tenantId]);
    if (!tenantExists) throw new NotFoundException('Şirket bulunamadı.');

    const before = await this.db.one(
      `SELECT is_enabled, valid_until, seat_limit FROM platform.tenant_modules
        WHERE tenant_id = $1 AND module_key = $2`,
      [tenantId, moduleKey],
    );

    const after = await this.db.one(
      `INSERT INTO platform.tenant_modules
          (tenant_id, module_key, is_enabled, valid_until, seat_limit, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, module_key) DO UPDATE
           SET is_enabled = EXCLUDED.is_enabled,
               valid_until = EXCLUDED.valid_until,
               seat_limit = coalesce(EXCLUDED.seat_limit, platform.tenant_modules.seat_limit),
               updated_by = EXCLUDED.updated_by
       RETURNING tenant_id, module_key, is_enabled, valid_until, seat_limit, enabled_at, disabled_at`,
      [tenantId, moduleKey, dto.enabled, dto.validUntil ?? null, dto.seatLimit ?? null,
       ctx?.adminUserId ?? null],
    );

    // Take effect on the very next request rather than after a cache TTL.
    this.licensing.invalidate(tenantId);
    this.sessions.invalidateTenant(tenantId);

    await this.audit.record({
      action: dto.enabled ? 'module.enabled' : 'module.disabled',
      entityType: 'tenant_module',
      entityId: `${tenantId}:${moduleKey}`,
      tenantId,
      before,
      after: { ...after, reason: dto.reason },
    });

    // Tell the tenant, so a disappearing menu item is never a mystery.
    await this.db.execute(
      // Explicit casts: several arguments are NULL, and PostgreSQL cannot
      // resolve the overload from an untyped parameter.
      `SELECT app.emit_notification($1::uuid, $2::text, $3::text, $4::text, $5::text,
                                    $6::text, $7::text, $8::int, $9::date, $10::text)`,
      [
        tenantId,
        'module.licensing',
        moduleKey,
        dto.enabled
          ? `"${module.name}" modülü hesabınızda etkinleştirildi`
          : `"${module.name}" modülü hesabınızda kapatıldı`,
        dto.reason ?? null,
        'module_toggle',
        `${tenantId}:${moduleKey}:${Date.now()}`,
        null,
        dto.validUntil ?? null,
        null,
      ],
    );

    return after;
  }

  /** Bulk apply, e.g. after a plan upgrade. */
  async applyPlanBundle(tenantId: string, planId: string) {
    const updated = await this.db.transaction(async (db) => {
      const rows = await db.query<{ module_key: string }>(
        `INSERT INTO platform.tenant_modules (tenant_id, module_key, is_enabled)
         SELECT $1, pm.module_key, true FROM platform.plan_modules pm WHERE pm.plan_id = $2
         ON CONFLICT (tenant_id, module_key) DO UPDATE SET is_enabled = true
         RETURNING module_key`,
        [tenantId, planId],
      );
      return rows.map((r) => r.module_key);
    });

    this.licensing.invalidate(tenantId);
    this.sessions.invalidateTenant(tenantId);

    await this.audit.record({
      action: 'module.plan_bundle_applied',
      entityType: 'tenant',
      entityId: tenantId,
      tenantId,
      after: { modules: updated, planId },
    });

    return { enabled: updated };
  }
}
