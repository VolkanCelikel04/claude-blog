import { Injectable, NotFoundException } from '@nestjs/common';
import { PlatformDb } from '../../common/database/platform-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { SessionService } from '../../common/auth/session.service';
import { CreateSubscriptionDto, RenewSubscriptionDto } from './platform-admin.dto';

/**
 * Subscription / licence period management.
 *
 * ends_on is what the 30/15/7/3 alert ladder counts down to, so renewing here
 * is what makes the warnings stop - nothing else needs clearing.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly db: PlatformDb,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async plans() {
    return this.db.query(
      `SELECT p.*, array_remove(array_agg(pm.module_key), NULL) AS modules
         FROM platform.plans p
         LEFT JOIN platform.plan_modules pm ON pm.plan_id = p.id
        WHERE p.is_active
        GROUP BY p.id ORDER BY p.price`,
    );
  }

  async expiring(withinDays = 30) {
    return this.db.query(
      `SELECT * FROM platform.v_tenant_overview
        WHERE days_remaining IS NOT NULL AND days_remaining <= $1
        ORDER BY days_remaining`,
      [withinDays],
    );
  }

  async create(tenantId: string, dto: CreateSubscriptionDto) {
    const created = await this.db.one(
      `INSERT INTO platform.subscriptions
          (tenant_id, plan_id, status, starts_on, ends_on, seats, price_override, auto_renew, notes)
       VALUES ($1, $2, 'active', $3, $4, coalesce($5, 5), $6, coalesce($7, true), $8)
       RETURNING *`,
      [tenantId, dto.planId, dto.startsOn, dto.endsOn, dto.seats ?? null,
       dto.priceOverride ?? null, dto.autoRenew ?? null, dto.notes ?? null],
    );

    this.sessions.invalidateTenant(tenantId);
    await this.audit.record({
      action: 'subscription.created',
      entityType: 'subscription',
      entityId: (created as { id: string }).id,
      tenantId,
      after: created,
    });
    return created;
  }

  /**
   * Extends the current period. Because notification dedupe keys embed the due
   * date, the old warnings stay in history and a fresh ladder starts for the
   * new end date.
   */
  async renew(subscriptionId: string, dto: RenewSubscriptionDto) {
    const before = await this.db.one<{ tenant_id: string; ends_on: Date }>(
      `SELECT tenant_id, ends_on FROM platform.subscriptions WHERE id = $1`,
      [subscriptionId],
    );
    if (!before) throw new NotFoundException('Abonelik bulunamadı.');

    const after = await this.db.one(
      `UPDATE platform.subscriptions
          SET ends_on = $2,
              status = 'active',
              price_override = coalesce($3, price_override),
              notes = coalesce($4, notes)
        WHERE id = $1
      RETURNING *`,
      [subscriptionId, dto.endsOn, dto.priceOverride ?? null, dto.notes ?? null],
    );

    // A renewed tenant that was suspended for expiry becomes active again.
    await this.db.execute(
      `UPDATE platform.tenants SET status = 'active'
        WHERE id = $1 AND status = 'suspended'`,
      [before.tenant_id],
    );

    this.sessions.invalidateTenant(before.tenant_id);

    await this.audit.record({
      action: 'subscription.renewed',
      entityType: 'subscription',
      entityId: subscriptionId,
      tenantId: before.tenant_id,
      before,
      after,
    });

    return after;
  }

  async cancel(subscriptionId: string, reason?: string) {
    const result = await this.db.one(
      `UPDATE platform.subscriptions
          SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2
        WHERE id = $1 RETURNING *`,
      [subscriptionId, reason ?? null],
    );
    if (!result) throw new NotFoundException('Abonelik bulunamadı.');

    const tenantId = (result as { tenant_id: string }).tenant_id;
    this.sessions.invalidateTenant(tenantId);

    await this.audit.record({
      action: 'subscription.cancelled',
      entityType: 'subscription',
      entityId: subscriptionId,
      tenantId,
      after: { reason },
    });
    return result;
  }
}
