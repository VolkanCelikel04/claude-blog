import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { AlertsService } from './alerts.service';
import { RequireAudience } from '../auth/decorators';
import { RequireAdminRole, RequirePermissions } from '../rbac/permissions.decorator';

@ApiTags('notifications')
@Controller('notifications')
@RequireAudience('tenant')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions('notifications.read')
  @ApiOperation({ summary: 'Bildirim kutusu (30/15/7/3 gün uyarıları dahil)' })
  inbox(@Query('onlyUnread') onlyUnread?: string, @Query('limit') limit?: string) {
    return this.notifications.inbox({
      onlyUnread: onlyUnread === 'true',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post(':id/read')
  @RequirePermissions('notifications.read')
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(id);
  }

  @Post('read-all')
  @RequirePermissions('notifications.read')
  markAllRead() {
    return this.notifications.markAllRead();
  }

  @Post(':id/dismiss')
  @RequirePermissions('notifications.read')
  dismiss(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.dismiss(id);
  }
}

@ApiTags('platform-admin')
@Controller('admin/alerts')
@RequireAudience('platform')
export class AdminAlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Post('run')
  @RequireAdminRole('operations')
  @ApiOperation({ summary: 'Uyarı motorunu elle çalıştır (idempotent)' })
  run(@Query('asOf') asOf?: string) {
    return this.alerts.runAlertEngine(asOf);
  }

  @Post('maintenance')
  @RequireAdminRole('operations')
  @ApiOperation({ summary: 'Günlük bakım: süre dolumları + uyarı merdiveni + dağıtım' })
  maintenance(@Query('asOf') asOf?: string) {
    return this.alerts.runDailyMaintenance(asOf);
  }

  @Post('dispatch')
  @RequireAdminRole('operations')
  dispatch() {
    return this.alerts.dispatchPending();
  }
}
