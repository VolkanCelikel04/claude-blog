import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AlertsService } from './alerts.service';
import { AlertsScheduler } from './alerts.scheduler';
import { NotificationChannel } from './notification-channel';
import { NotificationsService } from './notifications.service';
import { AdminAlertsController, NotificationsController } from './notifications.controller';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [NotificationsController, AdminAlertsController],
  providers: [AlertsService, AlertsScheduler, NotificationChannel, NotificationsService],
  exports: [AlertsService],
})
export class AlertsModule {}
