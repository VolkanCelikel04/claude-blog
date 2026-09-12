import { Global, Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AppConfig } from '../config/configuration';
import { PLATFORM_POOL, TENANT_POOL } from './database.constants';
import { TenantDb } from './tenant-db.service';
import { PlatformDb } from './platform-db.service';

/**
 * Two connection pools, two database roles.
 *
 *   TENANT_POOL   -> vgantt_api           (row level security ALWAYS applies)
 *   PLATFORM_POOL -> vgantt_platform_api  (BYPASSRLS, admin routes only)
 *
 * Keeping them apart means a tenant-side query - however badly written - has no
 * mechanism to read another tenant's rows. The isolation is a property of the
 * connection, not of the code that happens to run on it.
 */
@Global()
@Module({
  providers: [
    {
      provide: TENANT_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const db = config.getOrThrow<AppConfig['db']>('db');
        return new Pool({
          host: db.host,
          port: db.port,
          database: db.database,
          user: db.app.user,
          password: db.app.password,
          max: db.app.max,
          ssl: db.ssl ? { rejectUnauthorized: true } : undefined,
          application_name: 'vgantt-api/tenant',
          statement_timeout: 15_000,
          idle_in_transaction_session_timeout: 10_000,
        });
      },
    },
    {
      provide: PLATFORM_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const db = config.getOrThrow<AppConfig['db']>('db');
        return new Pool({
          host: db.host,
          port: db.port,
          database: db.database,
          user: db.platform.user,
          password: db.platform.password,
          max: db.platform.max,
          ssl: db.ssl ? { rejectUnauthorized: true } : undefined,
          application_name: 'vgantt-api/platform',
          statement_timeout: 30_000,
        });
      },
    },
    TenantDb,
    PlatformDb,
  ],
  exports: [TenantDb, PlatformDb, TENANT_POOL, PLATFORM_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(TENANT_POOL) private readonly tenantPool: Pool,
    @Inject(PLATFORM_POOL) private readonly platformPool: Pool,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.tenantPool.end(), this.platformPool.end()]);
  }
}
