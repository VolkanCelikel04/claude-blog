import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

export interface OutboundNotification {
  id: string;
  tenantId: string | null;
  audience: 'tenant' | 'platform';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string | null;
  dueDate: string | null;
  thresholdDays: number | null;
  recipients: string[];
}

/**
 * Out-of-band delivery for alerts that already exist in the database.
 *
 * In-app notifications need no channel: they are rows the UI reads. This class
 * only handles e-mail / webhook fan-out, and it is deliberately best-effort -
 * a mail server outage must never roll back the alert itself.
 */
@Injectable()
export class NotificationChannel {
  private readonly logger = new Logger(NotificationChannel.name);

  constructor(private readonly config: ConfigService) {}

  async deliver(notification: OutboundNotification): Promise<boolean> {
    const alerts = this.config.getOrThrow<AppConfig['alerts']>('alerts');

    try {
      switch (alerts.mailTransport) {
        case 'console':
          this.logger.log(
            `[${notification.severity.toUpperCase()}] ${notification.title} ` +
              `-> ${notification.recipients.join(', ') || '(no recipients)'}` +
              (notification.body ? `\n         ${notification.body}` : ''),
          );
          return true;

        case 'webhook': {
          if (!alerts.webhookUrl) {
            this.logger.warn('ALERT_WEBHOOK_URL is not set; skipping delivery');
            return false;
          }
          const response = await fetch(alerts.webhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(notification),
            signal: AbortSignal.timeout(10_000),
          });
          return response.ok;
        }

        case 'smtp':
          // Wire your SMTP client here (nodemailer et al). Kept out of the
          // dependency tree until a transport is actually chosen.
          this.logger.warn('SMTP transport selected but no client is configured');
          return false;

        default:
          return false;
      }
    } catch (error) {
      this.logger.error(`Delivery failed for ${notification.id}`, error as Error);
      return false;
    }
  }
}
