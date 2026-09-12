import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is making the current request.
 *
 * Held in AsyncLocalStorage so services, repositories and the audit interceptor
 * can read it without threading a "tenantId" argument through every signature -
 * and, more importantly, so no code path can accidentally run a tenant query
 * with someone else's identity.
 *
 * The object is created by RequestContextMiddleware and then *mutated* by the
 * auth guard once the caller is known. Mutation rather than re-entry keeps a
 * single object identity for the whole request, which is what makes
 * RequestContextStore.get() work in guards, pipes, handlers and interceptors
 * alike.
 */
export interface RequestContext {
  requestId: string;
  /** Present for tenant traffic, absent for VganttAdmin traffic. */
  tenantId?: string;
  tenantSlug?: string;
  userId?: string;
  /** Present for VganttAdmin traffic. */
  adminUserId?: string;
  adminRole?: string;
  permissions: Set<string>;
  enabledModules: Set<string>;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const RequestContextStore = {
  /** Binds a context to the current async execution chain (middleware entry point). */
  enter(context: RequestContext): void {
    storage.enterWith(context);
  },

  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },

  /** The context of the in-flight request, or undefined outside one (cron jobs). */
  get(): RequestContext | undefined {
    return storage.getStore();
  },

  /** Throws when called from a code path that must be tenant-scoped but is not. */
  requireTenant(): { tenantId: string; userId: string } {
    const ctx = storage.getStore();
    if (!ctx?.tenantId || !ctx.userId) {
      throw new Error(
        'No tenant context bound. This code path must run inside an authenticated tenant request.',
      );
    }
    return { tenantId: ctx.tenantId, userId: ctx.userId };
  },
};

export function createRequestContext(partial: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: partial.requestId ?? cryptoRandomId(),
    permissions: partial.permissions ?? new Set<string>(),
    enabledModules: partial.enabledModules ?? new Set<string>(),
    ...partial,
  };
}

function cryptoRandomId(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node:crypto').randomUUID();
}
