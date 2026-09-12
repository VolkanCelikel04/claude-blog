import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { ModuleLicensingService } from './module-licensing.service';
import { SubscriptionsService } from './subscriptions.service';
import { BillingService } from './billing.service';
import {
  CreatePlatformInvoiceDto, CreateSubscriptionDto, CreateTenantDto,
  RecordPlatformPaymentDto, RenewSubscriptionDto, ToggleModuleDto, UpdateTenantDto,
} from './platform-admin.dto';
import { RequireAudience } from '../../common/auth/decorators';
import { RequireAdminRole } from '../../common/rbac/permissions.decorator';

/**
 * VganttAdmin control plane.
 *
 * @RequireAudience('platform') means a tenant access token is rejected here
 * before any handler runs, and every query below uses the platform pool.
 */
@ApiTags('platform-admin')
@Controller('admin')
@RequireAudience('platform')
export class PlatformAdminController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly modules: ModuleLicensingService,
    private readonly subscriptions: SubscriptionsService,
    private readonly billing: BillingService,
  ) {}

  // ------------------------------------------------------------- dashboard
  @Get('dashboard')
  @ApiOperation({ summary: 'Tenant sayıları, gelir grafiği, süresi yaklaşanlar, uyarılar' })
  dashboard() {
    return this.tenants.dashboard();
  }

  // -------------------------------------------------------- tenant yönetimi
  @Get('tenants')
  listTenants(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('expiringWithin') expiringWithin?: string,
  ) {
    return this.tenants.list({
      search,
      status,
      expiringWithin: expiringWithin ? Number(expiringWithin) : undefined,
    });
  }

  @Get('tenants/:id')
  tenantDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.findOne(id);
  }

  @Post('tenants')
  @RequireAdminRole('operations')
  @ApiOperation({ summary: 'Yeni şirket: kayıt + iletişim + abonelik + modüller + ilk yönetici' })
  createTenant(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  @Patch('tenants/:id')
  @RequireAdminRole('operations')
  updateTenant(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(id, dto);
  }

  @Post('tenants/:id/deactivate')
  @RequireAdminRole('operations')
  @ApiOperation({ summary: 'Pasife al: veriler korunur, oturumlar anında iptal edilir' })
  deactivate(@Param('id', ParseUUIDPipe) id: string, @Body('reason') reason?: string) {
    return this.tenants.deactivate(id, reason);
  }

  @Post('tenants/:id/reactivate')
  @RequireAdminRole('operations')
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.reactivate(id);
  }

  // ----------------------------------------------------- modül lisanslama
  @Get('modules')
  moduleCatalogue() {
    return this.modules.catalogue();
  }

  @Get('modules/matrix')
  @ApiOperation({ summary: 'Tenant x modül ızgarası (arayüzdeki aç/kapa anahtarları)' })
  moduleMatrix(@Query('tenantId') tenantId?: string) {
    return this.modules.matrix(tenantId);
  }

  @Put('tenants/:tenantId/modules/:moduleKey')
  @RequireAdminRole('operations')
  @ApiOperation({
    summary: 'Tek tık modül aç/kapa',
    description:
      'Kapatıldığında: menüden kalkar, API 402 döner ve RLS satırları görünmez yapar. Veri silinmez.',
  })
  toggleModule(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() dto: ToggleModuleDto,
  ) {
    return this.modules.toggle(tenantId, moduleKey, dto);
  }

  @Post('tenants/:tenantId/modules/apply-plan/:planId')
  @RequireAdminRole('operations')
  applyPlan(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.modules.applyPlanBundle(tenantId, planId);
  }

  // ---------------------------------------------------------- abonelikler
  @Get('plans')
  plans() {
    return this.subscriptions.plans();
  }

  @Get('subscriptions/expiring')
  @ApiOperation({ summary: 'Lisans/abonelik bitimi yaklaşan şirketler' })
  expiring(@Query('withinDays') withinDays?: string) {
    return this.subscriptions.expiring(withinDays ? Number(withinDays) : 30);
  }

  @Post('tenants/:tenantId/subscriptions')
  @RequireAdminRole('billing')
  createSubscription(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.subscriptions.create(tenantId, dto);
  }

  @Post('subscriptions/:id/renew')
  @RequireAdminRole('billing')
  renewSubscription(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RenewSubscriptionDto) {
    return this.subscriptions.renew(id, dto);
  }

  @Post('subscriptions/:id/cancel')
  @RequireAdminRole('billing')
  cancelSubscription(@Param('id', ParseUUIDPipe) id: string, @Body('reason') reason?: string) {
    return this.subscriptions.cancel(id, reason);
  }

  // --------------------------------------------------------- ödeme takibi
  @Get('invoices')
  invoices(
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: string,
    @Query('overdueOnly') overdueOnly?: string,
  ) {
    return this.billing.listInvoices({
      tenantId,
      status,
      overdueOnly: overdueOnly === 'true',
    });
  }

  @Post('invoices')
  @RequireAdminRole('billing')
  createInvoice(@Body() dto: CreatePlatformInvoiceDto) {
    return this.billing.createInvoice(dto);
  }

  @Post('invoices/:id/payments')
  @RequireAdminRole('billing')
  recordPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordPlatformPaymentDto) {
    return this.billing.recordPayment(id, dto);
  }

  @Get('revenue')
  revenue() {
    return this.billing.revenueSummary();
  }
}
