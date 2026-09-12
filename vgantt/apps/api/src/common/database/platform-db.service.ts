import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { PLATFORM_POOL } from './database.constants';

export interface PlatformQueryRunner {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T | undefined>;
  execute(text: string, params?: readonly unknown[]): Promise<number>;
}

/**
 * The VganttAdmin control plane, and the few pre-authentication lookups that
 * cannot have a tenant context yet (finding a user by e-mail at login).
 *
 * Its role bypasses row level security, so anything reached from here must
 * already have been authorised by a guard. Treat every method as privileged.
 */
@Injectable()
export class PlatformDb {
  private readonly logger = new Logger(PlatformDb.name);

  constructor(@Inject(PLATFORM_POOL) private readonly pool: Pool) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, params as unknown[]);
    return result.rows;
  }

  async one<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T | undefined> {
    const rows = await this.query<T>(text, params);
    return rows[0];
  }

  async execute(text: string, params: readonly unknown[] = []): Promise<number> {
    const result = await this.pool.query(text, params as unknown[]);
    return result.rowCount ?? 0;
  }

  /** Multi-statement admin operations that must succeed or fail together. */
  async transaction<T>(work: (db: PlatformQueryRunner) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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

  private runnerFor(client: PoolClient): PlatformQueryRunner {
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
