import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestContext, RequestContextStore } from '../context/request-context';
import { Audience } from './auth.types';

export const IS_PUBLIC_KEY = 'vgantt:public';
/** Skips authentication entirely (login, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const AUDIENCE_KEY = 'vgantt:audience';
/**
 * Restricts a route to one side of the product.
 *   @Audience('platform')  -> VganttAdmin tokens only
 *   @Audience('tenant')    -> tenant member tokens only (the default)
 */
export const RequireAudience = (audience: Audience) => SetMetadata(AUDIENCE_KEY, audience);

/** Injects the resolved request context into a handler parameter. */
export const Ctx = createParamDecorator(
  (_data: unknown, _context: ExecutionContext): RequestContext => {
    const ctx = RequestContextStore.get();
    if (!ctx) throw new Error('Request context unavailable');
    return ctx;
  },
);
