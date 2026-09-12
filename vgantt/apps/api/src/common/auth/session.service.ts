import { Injectable } from '@nestjs/common';
import { PlatformDb } from '../database/platform-db.service';
import { TenantSession } from './auth.types';

interface SessionRow {
  user_id: string;
  email: string;
  full_name: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  tenant_status: string;
  subscription_status: string | null;
  ends_on: Date | null;
  days_remaining: number | null;
  permissions: string[] | null;
  roles: string[] | null;
  modules: string[] | null;
}

/**
 * Resolves "who is this user and what may they do" in a single round trip.
 *
 * Permissions are read per request (with a short cache) rather than baked into
 * the JWT, so revoking a role or switching off a module takes effect at once
 * instead of when the token happens to expire.
 */
@Injectable()
export class SessionService {
  private readonly cache = new Map<string, { session: TenantSession; expiresAt: number }>();
  private readonly ttlMs = 15_000;

  constructor(private readonly platformDb: PlatformDb) {}

  async loadTenantSession(userId: string): Promise<TenantSession | null> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.session;

    const row = await this.platformDb.one<SessionRow>(
      `SELECT
           u.id            AS user_id,
           u.email::text   AS email,
           u.full_name,
           t.id            AS tenant_id,
           t.slug::text    AS tenant_slug,
           t.name          AS tenant_name,
           t.status::text  AS tenant_status,
           s.status::text  AS subscription_status,
           s.ends_on,
           (s.ends_on - current_date) AS days_remaining,
           (SELECT array_agg(DISTINCT vp.permission_key)
              FROM app.v_user_permissions vp WHERE vp.user_id = u.id)     AS permissions,
           (SELECT array_agg(DISTINCT r.key)
              FROM app.user_roles ur JOIN app.roles r ON r.id = ur.role_id
             WHERE ur.user_id = u.id)                                      AS roles,
           (SELECT array_agg(tm.module_key)
              FROM platform.tenant_modules tm
              JOIN platform.modules m ON m.key = tm.module_key
             WHERE tm.tenant_id = t.id AND tm.is_enabled AND m.is_active
               AND (tm.valid_until IS NULL OR tm.valid_until >= current_date)) AS modules
       FROM app.users u
       JOIN platform.tenants t ON t.id = u.tenant_id
       LEFT JOIN LATERAL (
            SELECT * FROM platform.subscriptions s2
             WHERE s2.tenant_id = t.id AND s2.status IN ('trial','active','past_due')
             ORDER BY s2.ends_on DESC LIMIT 1) s ON true
       WHERE u.id = $1 AND u.is_active`,
      [userId],
    );

    if (!row) return null;

    const session: TenantSession = {
      userId: row.user_id,
      tenantId: row.tenant_id,
      tenantSlug: row.tenant_slug,
      tenantName: row.tenant_name,
      email: row.email,
      fullName: row.full_name,
      permissions: row.permissions ?? [],
      enabledModules: row.modules ?? [],
      roles: row.roles ?? [],
      subscription: row.subscription_status
        ? {
            status: row.subscription_status,
            endsOn: row.ends_on ? row.ends_on.toISOString().slice(0, 10) : null,
            daysRemaining: row.days_remaining,
          }
        : null,
    };

    this.cache.set(userId, { session, expiresAt: Date.now() + this.ttlMs });
    return session;
  }

  invalidateUser(userId: string): void {
    this.cache.delete(userId);
  }

  invalidateTenant(tenantId: string): void {
    for (const [userId, entry] of this.cache.entries()) {
      if (entry.session.tenantId === tenantId) this.cache.delete(userId);
    }
  }
}
