import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import { Injectable, type NestMiddleware } from '@nestjs/common';

import { OpContextService } from './op-context.service';
import { extractTraceId, TRACE_ID_HEADER } from './trace-id.utils';

type RequestLike = { headers: IncomingHttpHeaders; user?: { id?: string } };
type ResponseLike = { setHeader: (k: string, v: string) => void };

/**
 * Creates the per-request AsyncLocalStorage store as early as Nest allows.
 *
 * Middleware runs before guards, pipes and interceptors, so registering this
 * (via `consumer.apply(HttpContextMiddleware).forRoutes('*')`) makes the trace id
 * available to everything in the request pipeline. The store is scoped with
 * `als.run`, so it can never leak into other requests.
 *
 * `HttpContextInterceptor` reuses the store created here and only adds the
 * `http.request` start/finish/error events.
 */
@Injectable()
export class HttpContextMiddleware implements NestMiddleware {
  constructor(private readonly ctx: OpContextService) {}

  use(req: RequestLike, res: ResponseLike, next: () => void): void {
    const traceId = extractTraceId(req.headers) ?? randomUUID();
    res.setHeader(TRACE_ID_HEADER, traceId);
    const store = this.ctx.create(traceId, req.user?.id);
    this.ctx.runWith(store, next);
  }
}
