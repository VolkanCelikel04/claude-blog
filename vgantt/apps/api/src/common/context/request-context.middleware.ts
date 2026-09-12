import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { createRequestContext, RequestContextStore } from './request-context';

declare module 'express-serve-static-core' {
  interface Request {
    vganttContext?: ReturnType<typeof createRequestContext>;
  }
}

/**
 * Opens an empty context at the very start of the request, before guards run.
 * The auth guard fills in the identity; everything downstream just reads it.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();

    const context = createRequestContext({
      requestId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    req.vganttContext = context;
    res.setHeader('x-request-id', requestId);

    RequestContextStore.enter(context);
    next();
  }
}
