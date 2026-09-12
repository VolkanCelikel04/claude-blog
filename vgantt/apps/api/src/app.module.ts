import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { loadConfiguration } from './common/config/configuration';
import { DatabaseModule } from './common/database/database.module';
import { AuthModule } from './common/auth/auth.module';
import { AuditModule } from './common/audit/audit.module';
import { AlertsModule } from './common/alerts/alerts.module';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { ModuleLicenseGuard } from './common/licensing/module-license.guard';
import { PermissionsGuard } from './common/rbac/permissions.guard';
import { LicensingService } from './common/licensing/licensing.service';
import { HealthController } from './common/http/health.controller';

import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { LicensesModule } from './modules/licenses/licenses.module';
import { FinanceModule } from './modules/finance/finance.module';
import { VaultModule } from './modules/vault/vault.module';

/**
 * Guard order is the security model, so it is spelled out here rather than
 * scattered across controllers:
 *
 *   1. JwtAuthGuard        - who are you? binds tenant/admin identity
 *   2. ModuleLicenseGuard  - has VganttAdmin licensed this module to you?
 *   3. PermissionsGuard    - does your role allow this action?
 *
 * Row level security then repeats the tenant check inside PostgreSQL, so a bug
 * in any of the three cannot turn into cross-tenant data access.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [loadConfiguration],
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule,
    AuthModule,
    AuditModule,
    AlertsModule,

    // --- licensed business modules -----------------------------------------
    PlatformAdminModule,
    LicensesModule,   // module A
    FinanceModule,    // module B
    VaultModule,      // module C (metadata only - contents stay on C:/Rsdw)
  ],
  controllers: [HealthController],
  providers: [
    LicensingService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ModuleLicenseGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [LicensingService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
