import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import { OpContextService } from './op-context.service';
import { OpLoggerService } from './op-logger.service';
import { extractTraceId, TRACE_ID_HEADER } from './trace-id.utils';

type RequestLike = {
  method: string;
  url: string;
  originalUrl?: string;
  headers: IncomingHttpHeaders;
  user?: { id?: string };
};
type ResponseLike = { statusCode: number; setHeader: (k: string, v: string) => void };

/**
 * Logs the `http.request` lifecycle (start / finish / error) for every handled request.
 *
 * If `HttpContextMiddleware` already established a store for this request it is
 * reused (and enriched with `req.user`, which guards may have populated by now).
 * Otherwise a new store is created and scoped with `als.run` around the handler
 * chain, so it never leaks outside the request.
 */
@Injectable()
export class HttpContextInterceptor implements NestInterceptor {
  constructor(
    private readonly ctx: OpContextService,
    private readonly log: OpLoggerService,
  ) {}

  intercept(ex: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ex.switchToHttp();
    const req = http.getRequest<RequestLike>();
    const res = http.getResponse<ResponseLike>();
    const url = req.originalUrl ?? req.url;

    const existing = this.ctx.get();
    const store = existing ?? this.ctx.create(extractTraceId(req.headers) ?? randomUUID(), req.user?.id);
    if (existing && req.user?.id && !existing.user?.id) existing.user = { id: req.user.id };
    if (!existing) res.setHeader(TRACE_ID_HEADER, store.traceId);

    return new Observable<unknown>((subscriber) =>
      this.ctx.runWith(store, () => {
        this.log.start('http.request', {
          module: 'Http',
          http: { method: req.method, url },
          msg: `${req.method} ${url}`,
        });

        let ok = true;
        return next
          .handle()
          .pipe(
            catchError((err: unknown) => {
              ok = false;
              this.log.error('http.request', err, { http: { status: res.statusCode } });
              throw err;
            }),
            finalize(() => {
              if (ok) this.log.finish('http.request', { http: { status: res.statusCode } });
            }),
          )
          .subscribe(subscriber);
      }),
    );
  }
}
