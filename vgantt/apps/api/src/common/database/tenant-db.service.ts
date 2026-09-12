import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { TENANT_POOL } from './database.constants';
import { RequestContextStore } from '../context/request-context';

export interface TenantQueryRunner {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T | undefined>;
  /** Escape hatch for callers that need rowCount (DELETE/UPDATE). */
  execute(text: string, params?: readonly unknown[]): Promise<number>;
}

/**
 * Every tenant query goes through here.
 *
 * The sequence is always: checkout -> BEGIN -> app.set_tenant_context(...) ->
 * work -> COMMIT/ROLLBACK -> release. Because the context is set with SET LOCAL
 * semantics it dies with the transaction, so a pooled connection can never
 * carry tenant A's binding into tenant B's next request.
 */
@Injectable()
export class TenantDb {
  private readonly logger = new Logger(TenantDb.name);

  constructor(@Inject(TENANT_POOL) private readonly pool: Pool) {}

  /**
   * Runs `work` inside a transaction bound to the caller's tenant.
   * The tenant id comes from the request context, never from user input.
   */
  async withTenant<T>(work: (db: TenantQueryRunner) => Promise<T>): Promise<T> {
    const { tenantId, userId } = RequestContextStore.requireTenant();
    return this.withExplicitTenant(tenantId, userId, work);
  }

  /**
   * Same, for code that legitimately runs outside a request (scheduled jobs,
   * tests). Callers must be able to justify the tenant id they pass in.
   */
  async withExplicitTenant<T>(
    tenantId: string,
    userId: string | null,
    work: (db: TenantQueryRunner) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT app.set_tenant_context($1, $2)', [tenantId, userId]);

      const result = await work(this.runnerFor(client));

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        this.logger.error('ROLLBACK failed', rollbackError);
      });
      throw error;
    } finally {
      client.release();
    }
  }

  private runnerFor(client: PoolClient): TenantQueryRunner {
    return {
      query: async <T extends QueryResultRow>(text: string, params: readonly unknown[] = []) => {
        const result = await client.query<T>(text, params as unknown[]);
        return result.rows;
      },
      one: async <T extends QueryResultRow>(text: string, params: readonly unknown[] = []) => {
        const result = await client.query<T>(text, params as unknown[]);
        return result.rows[0];
      },
      execute: async (text: string, params: readonly unknown[] = []) => {
        const result = await client.query(text, params as unknown[]);
        return result.rowCount ?? 0;
      },
    };
  }
}
