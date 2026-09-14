import { type CallHandler, type ExecutionContext, NotFoundException } from '@nestjs/common';
import { defer, lastValueFrom, throwError } from 'rxjs';

import type { LogEvent } from '../src';
import { CoreLoggerService, HttpContextInterceptor, OpContextService, OpLoggerService } from '../src';

class ArrayTransport {
  readonly name = 'array';
  readonly events: LogEvent[] = [];
  log(event: LogEvent): void {
    this.events.push(event);
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('HttpContextInterceptor', () => {
  let ctx: OpContextService;
  let transport: ArrayTransport;
  let interceptor: HttpContextInterceptor;

  const createExecutionContext = (
    req: Record<string, unknown>,
    res: Record<string, unknown>,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    }) as unknown as ExecutionContext;

  // Mirrors Nest: the route handler runs lazily on subscribe.
  const createHandler = (handler: () => Promise<unknown>): CallHandler => ({
    handle: jest.fn(() => defer(handler)),
  });

  beforeEach(() => {
    ctx = new OpContextService();
    transport = new ArrayTransport();
    const core = new CoreLoggerService([transport]);
    interceptor = new HttpContextInterceptor(ctx, new OpLoggerService(ctx, core));
  });

  it('reuses incoming trace id, scopes the store around the handler, and sets the response header', async () => {
    const req = {
      method: 'GET',
      url: '/health',
      headers: { 'x-trace-id': 'trace-123', host: 'example.com' },
      user: { id: 'user-42' },
    };
    const res = { statusCode: 200, setHeader: jest.fn() };
    let seenInHandler: string | undefined;
    const handler = createHandler(async () => {
      await flush();
      seenInHandler = ctx.traceId();
      return 'ok';
    });

    await expect(
      lastValueFrom(interceptor.intercept(createExecutionContext(req, res), handler)),
    ).resolves.toBe('ok');
    await flush();

    expect(seenInHandler).toBe('trace-123');
    expect(res.setHeader).toHaveBeenCalledWith('x-trace-id', 'trace-123');
    expect(ctx.get()).toBeUndefined(); // nothing leaked past the request

    const [start, finish] = transport.events;
    expect(start).toEqual(
      expect.objectContaining({
        kind: 'start',
        event: 'http.request',
        traceId: 'trace-123',
        module: 'Http',
        http: { method: 'GET', url: '/health' },
        msg: 'GET /health',
        user: { id: 'user-42' },
      }),
    );
    expect(finish).toEqual(
      expect.objectContaining({
        kind: 'finish',
        event: 'http.request',
        traceId: 'trace-123',
        http: { status: 200 },
      }),
    );
    expect(finish.opId).toBe(start.opId);
    expect(finish.extra?.orphanOp).toBe(false);
  });

  it('extracts trace id from traceparent when header missing', async () => {
    const req = {
      method: 'POST',
      url: '/jobs',
      originalUrl: '/jobs?cursor=1',
      headers: { traceparent: '00-12345678901234567890123456789012-abcdefabcdefabcd-01' },
    };
    const res = { statusCode: 202, setHeader: jest.fn() };

    await lastValueFrom(
      interceptor.intercept(
        createExecutionContext(req, res),
        createHandler(() => Promise.resolve(null)),
      ),
    );
    await flush();

    expect(res.setHeader).toHaveBeenCalledWith('x-trace-id', '12345678901234567890123456789012');
    expect(transport.events[0]).toEqual(
      expect.objectContaining({
        traceId: '12345678901234567890123456789012',
        http: { method: 'POST', url: '/jobs?cursor=1' },
        msg: 'POST /jobs?cursor=1',
      }),
    );
  });

  it('logs error when downstream handler fails and propagates the exception', async () => {
    const req = { method: 'PATCH', url: '/orders/1', headers: {} };
    const res = { statusCode: 500, setHeader: jest.fn() };
    const handler: CallHandler = { handle: () => throwError(() => new Error('boom')) };

    await expect(
      lastValueFrom(interceptor.intercept(createExecutionContext(req, res), handler)),
    ).rejects.toThrow('boom');
    await flush();

    const kinds = transport.events.map((e) => e.kind);
    expect(kinds).toEqual(['start', 'error']);
    expect(transport.events[1]).toEqual(
      expect.objectContaining({ err: expect.objectContaining({ message: 'boom' }), http: { status: 500 } }),
    );
  });

  it('derives the error status from the HttpException when the response is still 200', async () => {
    const req = { method: 'GET', url: '/orders/42', headers: {} };
    const res = { statusCode: 200, setHeader: jest.fn() };
    const handler: CallHandler = { handle: () => throwError(() => new NotFoundException()) };

    await expect(
      lastValueFrom(interceptor.intercept(createExecutionContext(req, res), handler)),
    ).rejects.toThrow();
    await flush();

    expect(transport.events[1]).toEqual(
      expect.objectContaining({
        kind: 'error',
        http: { status: 404 },
        err: expect.objectContaining({ status: 404 }),
      }),
    );
  });

  it('assumes 500 for unknown errors and keeps a status a filter already set', async () => {
    const run = async (statusCode: number) => {
      const res = { statusCode, setHeader: jest.fn() };
      const handler: CallHandler = { handle: () => throwError(() => new TypeError('bad')) };
      await expect(
        lastValueFrom(
          interceptor.intercept(
            createExecutionContext({ method: 'GET', url: '/', headers: {} }, res),
            handler,
          ),
        ),
      ).rejects.toThrow('bad');
    };
    await run(200);
    await run(503);
    await flush();

    const statuses = transport.events.filter((e) => e.kind === 'error').map((e) => e.http?.status);
    expect(statuses).toEqual([500, 503]);
  });

  it('ignores a malformed x-trace-id header and generates its own', async () => {
    const req = { method: 'GET', url: '/', headers: { 'x-trace-id': 'bad id\r\nSet-Cookie: x' } };
    const res = { statusCode: 200, setHeader: jest.fn() };

    await lastValueFrom(
      interceptor.intercept(
        createExecutionContext(req, res),
        createHandler(() => Promise.resolve(1)),
      ),
    );
    await flush();

    const traceId = transport.events[0].traceId;
    expect(traceId).toHaveLength(36);
    expect(res.setHeader).toHaveBeenCalledWith('x-trace-id', traceId);
  });

  it('isolates concurrent requests from each other', async () => {
    const run = (traceId: string, delay: number) => {
      const req = { method: 'GET', url: `/${traceId}`, headers: { 'x-trace-id': traceId } };
      const res = { statusCode: 200, setHeader: jest.fn() };
      const handler = createHandler(async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return ctx.traceId();
      });
      return lastValueFrom(interceptor.intercept(createExecutionContext(req, res), handler));
    };

    const [a, b] = await Promise.all([run('trace-a', 10), run('trace-b', 1)]);
    await flush();

    expect(a).toBe('trace-a');
    expect(b).toBe('trace-b');
    const finishes = transport.events.filter((e) => e.kind === 'finish');
    expect(finishes.map((e) => e.traceId).sort()).toEqual(['trace-a', 'trace-b']);
    expect(finishes.every((e) => e.extra?.orphanOp === false)).toBe(true);
  });

  it('reuses a store established earlier in the pipeline and enriches it with req.user', async () => {
    const req = {
      method: 'GET',
      url: '/me',
      headers: { 'x-trace-id': 'ignored-header' },
      user: { id: 'user-7' },
    };
    const res = { statusCode: 200, setHeader: jest.fn() };
    const handler = createHandler(() => Promise.resolve(ctx.traceId()));

    const store = ctx.create('trace-from-middleware');
    const result = await ctx.runWith(store, () =>
      lastValueFrom(interceptor.intercept(createExecutionContext(req, res), handler)),
    );
    await flush();

    expect(result).toBe('trace-from-middleware');
    expect(res.setHeader).not.toHaveBeenCalled(); // middleware already did it
    expect(store.user).toEqual({ id: 'user-7' });
    expect(transport.events.every((e) => e.traceId === 'trace-from-middleware')).toBe(true);
    expect(transport.events[0].user).toEqual({ id: 'user-7' });
  });
});
