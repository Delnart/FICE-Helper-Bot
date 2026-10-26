import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // A malformed id from the client (findById('x') → CastError, new ObjectId('x')
    // → BSONError) is a 400, not a 5xx — one place instead of isValid() in every service.
    const name = (exception as Error | undefined)?.name;
    const badId = name === 'CastError' || name === 'BSONError';
    // E11000 that no service handled: a unique index (one queue per subject,
    // one pending swap, …) refused a duplicate — a conflict, not a crash.
    const duplicate = (exception as { code?: unknown } | null)?.code === 11000;

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : badId
          ? HttpStatus.BAD_REQUEST
          : duplicate
            ? HttpStatus.CONFLICT
            : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload =
      exception instanceof HttpException
        ? exception.getResponse()
        : {
            statusCode: status,
            message: badId ? 'Invalid id' : duplicate ? 'Already exists' : 'Internal server error',
          };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (badId || duplicate) {
      // Still a 4xx to the client, but it can also be our own bug (a non-hex id
      // from data, an unguarded insert race) — keep it visible in the logs.
      this.logger.warn(`${request.method} ${request.url} → ${status} ${name}: ${(exception as Error).message}`);
    }

    response.status(status).json(
      typeof payload === 'string'
        ? { statusCode: status, message: payload }
        : { statusCode: status, ...(payload as object) },
    );
  }
}
