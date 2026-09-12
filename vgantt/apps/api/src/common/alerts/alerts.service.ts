import { Injectable, Logger } from '@nestjs/common';
import { PlatformDb } from '../database/platform-db.service';
import { NotificationChannel } from './notification-channel';

export interface MaintenanceResult {
  as_of: string;
  subscriptions_expired: number;
  licenses_expired: number;
  items_marked_overdue: number;
  expense_occurrences_created: number;
  alerts: { total_created: number; by_source: Record<string, number> };
}

/**
 * Thin wrapper over the database-side engine.
 *
 * The rules (which day, which severity, which text) live in SQL so that the
 * ladder is identical whether it is triggered by the scheduler, by a manual
 * admin run, or by a migration. This class only decides *when* to run it and
 * what to do with the notifications it produced.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly db: PlatformDb,
    private readonly channel: NotificationChannel,
  ) {}

  /** Housekeeping + the 30/15/7/3 ladder for every registered source. */
  async runDailyMaintenance(asOf?: string): Promise<MaintenanceResult> {
    const row = await this.db.one<{ result: MaintenanceResult }>(
      `SELECT platform.run_daily_maintenance(coalesce($1::date, current_date)) AS result`,
      [asOf ?? null],
    );
    const result = row!.result;

    this.logger.log(
      `Maintenance ${result.as_of}: ${result.alerts.total_created} alerts ` +
        `(${JSON.stringify(result.alerts.by_source)}), ` +
        `${result.items_marked_overdue} items overdue, ` +
        `${result.subscriptions_expired} subscriptions expired`,
    );

    await this.dispatchPending();
    return result;
  }

  /** Alerts-only run, used by the admin "şimdi çalıştır" button. */
  async runAlertEngine(asOf?: string) {
    const row = await this.db.one<{ result: unknown }>(
      `SELECT platform.run_alert_engine(coalesce($1::date, current_date)) AS result`,
      [asOf ?? null],
    );
    await this.dispatchPending();
    return row!.result;
  }

  /**
   * Sends anything that has not been delivered yet, then stamps delivered_at.
   * Crash-safe: a notification is only marked delivered after the channel
   * reported success, so a restart retries instead of losing it.
   */
  async dispatchPending(limit = 200): Promise<{ sent: number; failed: number }> {
    const tenantRows = await this.db.query<{
      id: string; tenant_id: string; severity: string; title: string; body: string | null;
      due_date: Date | null; threshold_days: number | null; recipients: string[] | null;
    }>(
      `SELECT n.id, n.tenant_id, n.severity::text AS severity, n.title, n.body,
              n.due_date, n.threshold_days,
              (SELECT array_agg(u.email::text)
                 FROM app.users u
                WHERE u.tenant_id = n.tenant_id AND u.is_active
                  AND (n.user_id IS NULL OR u.id = n.user_id)) AS recipients
         FROM app.notifications n
        WHERE n.delivered_at IS NULL
          AND n.severity IN ('warning', 'critical')
        ORDER BY n.created_at
        LIMIT $1`,
      [limit],
    );

    const adminRows = await this.db.query<{
      id: string; tenant_id: string | null; severity: string; title: string; body: string | null;
      due_date: Date | null; threshold_days: number | null;
    }>(
      `SELECT id, tenant_id, severity::text AS severity, title, body, due_date, threshold_days
         FROM platform.admin_notifications
        WHERE delivered_at IS NULL
        ORDER BY created_at
        LIMIT $1`,
      [limit],
    );

    const adminRecipients = (
      await this.db.query<{ email: string }>(
        `SELECT email::text AS email FROM platform.admin_users WHERE is_active`,
      )
    ).map((r) => r.email);

    let sent = 0;
    let failed = 0;

    for (const row of tenantRows) {
      const ok = await this.channel.deliver({
        id: row.id,
        tenantId: row.tenant_id,
        audience: 'tenant',
        severity: row.severity as 'info' | 'warning' | 'critical',
        title: row.title,
        body: row.body,
        dueDate: row.due_date?.toISOString().slice(0, 10) ?? null,
        thresholdDays: row.threshold_days,
        recipients: row.recipients ?? [],
      });

      if (ok) {
        await this.db.execute(
          `UPDATE app.notifications SET delivered_at = now() WHERE id = $1`,
          [row.id],
        );
        sent += 1;
      } else {
        failed += 1;
      }
    }

    for (const row of adminRows) {
      const ok = await this.channel.deliver({
        id: row.id,
        tenantId: row.tenant_id,
        audience: 'platform',
        severity: row.severity as 'info' | 'warning' | 'critical',
        title: row.title,
        body: row.body,
        dueDate: row.due_date?.toISOString().slice(0, 10) ?? null,
        thresholdDays: row.threshold_days,
        recipients: adminRecipients,
      });

      if (ok) {
        await this.db.execute(
          `UPDATE platform.admin_notifications SET delivered_at = now() WHERE id = $1`,
          [row.id],
        );
        sent += 1;
      } else {
        failed += 1;
      }
    }

    if (sent || failed) {
      this.logger.log(`Dispatched ${sent} notifications, ${failed} failed`);
    }
    return { sent, failed };
  }
}
