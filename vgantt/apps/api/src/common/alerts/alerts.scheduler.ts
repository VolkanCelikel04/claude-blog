import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AlertsService } from './alerts.service';
import { AppConfig } from '../config/configuration';

/**
 * Registers the nightly job from configuration rather than a hard-coded
 * decorator, so the schedule is an operational setting (ALERTS_CRON) and the
 * job can be disabled entirely in environments that must stay quiet.
 */
@Injectable()
export class AlertsScheduler implements OnModuleInit {
  private readonly logger = new Logger(AlertsScheduler.name);
  private running = false;

  constructor(
    private readonly alerts: AlertsService,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const settings = this.config.getOrThrow<AppConfig['alerts']>('alerts');

    if (!settings.enabled) {
      this.logger.warn('Alert engine disabled (ALERTS_ENABLED=false)');
      return;
    }

    const job = new CronJob(settings.cron, () => {
      void this.tick();
    });

    this.registry.addCronJob('vgantt:daily-maintenance', job);
    job.start();
    this.logger.log(`Alert engine scheduled: ${settings.cron}`);
  }

  /**
   * Overlap guard: a long run must not be re-entered by the next tick. With
   * several API instances the database is still the arbiter - every generator
   * is idempotent through the dedupe key, so a duplicate run creates nothing.
   */
  private async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous maintenance run is still in progress; skipping this tick');
      return;
    }

    this.running = true;
    try {
      await this.alerts.runDailyMaintenance();
    } catch (error) {
      this.logger.error('Daily maintenance failed', error as Error);
    } finally {
      this.running = false;
    }
  }
}
