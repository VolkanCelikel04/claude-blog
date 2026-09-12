import { Injectable, Logger } from '@nestjs/common';
import { PlatformDb } from '../database/platform-db.service';
import { RequestContextStore } from '../context/request-context';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  tenantId?: string;
}

/**
 * Append-only trail. Writing goes through the platform pool because a
 * VganttAdmin action has no tenant context of its own but still records which
 * tenant it affected.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly platformDb: PlatformDb) {}

  async record(entry: AuditEntry): Promise<void> {
    const ctx = RequestContextStore.get();
    const actorType = ctx?.adminUserId ? 'platform_admin' : ctx?.userId ? 'tenant_user' : 'system';

    try {
      await this.platformDb.execute(
        `INSERT INTO audit.activity_log
           (actor_type, actor_id, tenant_id, action, entity_type, entity_id,
            before_state, after_state, ip_address, user_agent, request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          actorType,
          ctx?.adminUserId ?? ctx?.userId ?? null,
          entry.tenantId ?? ctx?.tenantId ?? null,
          entry.action,
          entry.entityType ?? null,
          entry.entityId ?? null,
          entry.before ? JSON.stringify(entry.before) : null,
          entry.after ? JSON.stringify(entry.after) : null,
          ctx?.ip ?? null,
          ctx?.userAgent ?? null,
          ctx?.requestId ?? null,
        ],
      );
    } catch (error) {
      // Never fail a business operation because the audit write failed, but do
      // make the gap visible.
      this.logger.error(`Audit write failed for ${entry.action}`, error as Error);
    }
  }
}
