import { Injectable } from '@nestjs/common';
import { TenantDb } from '../database/tenant-db.service';
import { RequestContextStore } from '../context/request-context';

/** The tenant-facing inbox: the bell icon and the dashboard warning strip. */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: TenantDb) {}

  async inbox(params: { onlyUnread?: boolean; limit?: number }) {
    const { userId } = RequestContextStore.requireTenant();
    const limit = params.limit ?? 50;

    return this.db.withTenant(async (db) => {
      const items = await db.query(
        `SELECT id, severity::text AS severity, category, module_key, title, body,
                source_type, source_id, threshold_days, due_date, action_url,
                is_read, created_at
           FROM app.notifications
          WHERE (user_id IS NULL OR user_id = $1)
            AND dismissed_at IS NULL
            AND ($2::boolean IS NOT TRUE OR NOT is_read)
          ORDER BY
            CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
            created_at DESC
          LIMIT $3`,
        [userId, params.onlyUnread ?? null, limit],
      );

      const [counts] = await db.query<{ unread: string; critical: string }>(
        `SELECT count(*) FILTER (WHERE NOT is_read)::text AS unread,
                count(*) FILTER (WHERE NOT is_read AND severity = 'critical')::text AS critical
           FROM app.notifications
          WHERE (user_id IS NULL OR user_id = $1) AND dismissed_at IS NULL`,
        [userId],
      );

      return { items, unread: Number(counts.unread), critical: Number(counts.critical) };
    });
  }

  async markRead(id: string) {
    return this.db.withTenant(async (db) =>
      db.one(
        `UPDATE app.notifications SET is_read = true, read_at = now()
          WHERE id = $1 RETURNING id, is_read`,
        [id],
      ),
    );
  }

  async markAllRead() {
    const count = await this.db.withTenant(async (db) =>
      db.execute(
        `UPDATE app.notifications SET is_read = true, read_at = now()
          WHERE NOT is_read AND dismissed_at IS NULL`,
      ),
    );
    return { updated: count };
  }

  async dismiss(id: string) {
    return this.db.withTenant(async (db) =>
      db.one(
        `UPDATE app.notifications SET dismissed_at = now() WHERE id = $1 RETURNING id`,
        [id],
      ),
    );
  }
}
