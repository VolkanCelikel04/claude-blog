import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { mapDatabaseError } from './database-error.mapper';
import { RequestContextStore } from '../context/request-context';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const ctx = RequestContextStore.get();

    const mapped = exception instanceof HttpException ? exception : mapDatabaseError(exception);

    const status = mapped?.getStatus?.() ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = mapped?.getResponse?.() ?? {
      statusCode: status,
      message: 'Beklenmeyen bir hata oluştu.',
    };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} [req=${ctx?.requestId}] ` +
          `[tenant=${ctx?.tenantId ?? '-'}]`,
        (exception as Error)?.stack,
      );
    } else if (status === HttpStatus.FORBIDDEN) {
      // An isolation refusal is not routine noise: surface it.
      this.logger.warn(
        `${request.method} ${request.url} -> 403 [req=${ctx?.requestId}] ` +
          `[tenant=${ctx?.tenantId ?? '-'}] ${(exception as Error)?.message}`,
      );
    }

    response.status(status).json(
      typeof payload === 'string'
        ? { statusCode: status, message: payload, requestId: ctx?.requestId }
        : { ...(payload as object), requestId: ctx?.requestId },
    );
  }
}
