import { Module } from '@nestjs/common';
import { PlatformAdminController } from './platform-admin.controller';
import { TenantsService } from './tenants.service';
import { ModuleLicensingService } from './module-licensing.service';
import { SubscriptionsService } from './subscriptions.service';
import { BillingService } from './billing.service';

@Module({
  controllers: [PlatformAdminController],
  providers: [TenantsService, ModuleLicensingService, SubscriptionsService, BillingService],
  exports: [ModuleLicensingService],
})
export class PlatformAdminModule {}
