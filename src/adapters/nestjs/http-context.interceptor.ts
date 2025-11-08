// src/adapters/nestjs/http-context.interceptor.ts
import { randomUUID } from 'node:crypto';

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'http';
import { Observable } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';

import { OpContextService } from './op-context.service';
import { OpLoggerService } from './op-logger.service';

@Injectable()
export class HttpContextInterceptor implements NestInterceptor {
  constructor(
    private readonly ctx: OpContextService,
    private readonly log: OpLoggerService,
  ) {}

  intercept(ex: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ex.switchToHttp();
    const req = http.getRequest<{
      method: string;
      url: string;
      originalUrl?: string;
      headers: IncomingHttpHeaders;
      user?: { id?: string };
    }>();
    const res = http.getResponse<{ statusCode: number; setHeader: (k: string, v: string) => void }>();

    const traceId = extractTraceId(req.headers) ?? randomUUID();
    const url = req.originalUrl ?? req.url;

    // Pin ALS store for the whole request lifecycle.
    const store = this.ctx.create(traceId, req.user?.id);
    this.ctx.enter(store);

    this.log.start('http.request', {
      module: 'Http',
      http: { method: req.method, url },
      msg: `${req.method} ${url}`,
    });

    res.setHeader('x-trace-id', traceId);

    // Ensure finish on success; error on failure; keep ALS active.
    let ok = true;

    return next.handle().pipe(
      tap(() => {
        /* no-op, but keeps operator chain */
      }),
      catchError((err: unknown) => {
        ok = false;
        this.log.error('http.request', err, { http: { status: res.statusCode } });
        throw err;
      }),
      finalize(() => {
        if (ok) {
          this.log.finish('http.request', { http: { status: res.statusCode } });
        }
      }),
    );
  }
}

function extractTraceId(headers: IncomingHttpHeaders): string | undefined {
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) map[k.toLowerCase()] = v[0] ?? '';
    else if (typeof v === 'string') map[k.toLowerCase()] = v;
  }
  return map['x-trace-id'] || fromTraceparent(map['traceparent']);
}

function fromTraceparent(tp?: string): string | undefined {
  if (!tp) return undefined;
  const parts = tp.split('-'); // version-traceId-parentId-flags
  return parts[1]?.length === 32 ? parts[1] : undefined;
}
