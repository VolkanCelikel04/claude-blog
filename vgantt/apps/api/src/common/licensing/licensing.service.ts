import { Injectable, Logger } from '@nestjs/common';
import { PlatformDb } from '../database/platform-db.service';
import { ModuleKey } from './module-registry';

interface ModuleRow {
  module_key: string;
  is_enabled: boolean;
  valid_until: Date | null;
  seat_limit: number | null;
}

interface CacheEntry {
  modules: Set<string>;
  expiresAt: number;
}

/**
 * Answers "may this tenant use module X right now?".
 *
 * Cached for a few seconds because it is consulted on every request. The cache
 * is invalidated explicitly the moment VganttAdmin flips a switch, so the
 * one-click toggle takes effect immediately rather than after a TTL.
 */
@Injectable()
export class LicensingService {
  private readonly logger = new Logger(LicensingService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 30_000;

  constructor(private readonly platformDb: PlatformDb) {}

  async enabledModulesFor(tenantId: string): Promise<Set<string>> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.modules;
    }

    const rows = await this.platformDb.query<ModuleRow>(
      `SELECT tm.module_key, tm.is_enabled, tm.valid_until, tm.seat_limit
         FROM platform.tenant_modules tm
         JOIN platform.modules m ON m.key = tm.module_key
        WHERE tm.tenant_id = $1
          AND tm.is_enabled
          AND m.is_active
          AND (tm.valid_until IS NULL OR tm.valid_until >= current_date)`,
      [tenantId],
    );

    const modules = new Set(rows.map((row) => row.module_key));
    this.cache.set(tenantId, { modules, expiresAt: Date.now() + this.ttlMs });
    return modules;
  }

  async isEnabled(tenantId: string, moduleKey: ModuleKey): Promise<boolean> {
    return (await this.enabledModulesFor(tenantId)).has(moduleKey);
  }

  /** Called by the admin toggle so the change is visible on the next request. */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
    this.logger.debug(`Module cache invalidated for tenant ${tenantId}`);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}
