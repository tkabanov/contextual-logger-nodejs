import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { lastValueFrom, of, throwError } from 'rxjs';

import { HttpContextInterceptor, OpContextService, OpLoggerService } from '../src';

describe('HttpContextInterceptor', () => {
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

  const createHandler = (stream: Observable<unknown>): CallHandler => ({
    handle: jest.fn(() => stream),
  });

  let ctxMock: { create: jest.Mock; enter: jest.Mock };
  let logMock: { start: jest.Mock; finish: jest.Mock; error: jest.Mock };
  let interceptor: HttpContextInterceptor;

  beforeEach(() => {
    ctxMock = {
      create: jest.fn(() => ({ traceId: 'trace-store' })),
      enter: jest.fn(),
    };
    logMock = {
      start: jest.fn(),
      finish: jest.fn(),
      error: jest.fn(),
    };
    interceptor = new HttpContextInterceptor(ctxMock as unknown as OpContextService, logMock as unknown as OpLoggerService);
  });

  it('reuses incoming trace id, logs lifecycle, and decorates response headers', async () => {
    const req = {
      method: 'GET',
      url: '/health',
      headers: { 'x-trace-id': 'trace-123', host: 'example.com' },
      user: { id: 'user-42' },
    };
    const res = { statusCode: 200, setHeader: jest.fn() };
    const handler = createHandler(of('ok'));

    const result$ = interceptor.intercept(createExecutionContext(req, res), handler);
    await expect(lastValueFrom(result$)).resolves.toBe('ok');

    expect(ctxMock.create).toHaveBeenCalledWith('trace-123', 'user-42');
    expect(ctxMock.enter).toHaveBeenCalledWith({ traceId: 'trace-store' });
    expect(logMock.start).toHaveBeenCalledWith('http.request', {
      module: 'Http',
      http: { method: 'GET', url: '/health' },
      msg: 'GET /health',
    });
    expect(logMock.finish).toHaveBeenCalledWith('http.request', { http: { status: 200 } });
    expect(res.setHeader).toHaveBeenCalledWith('x-trace-id', 'trace-123');
  });

  it('extracts trace id from traceparent when header missing', async () => {
    const req = {
      method: 'POST',
      url: '/jobs',
      originalUrl: '/jobs?cursor=1',
      headers: { traceparent: '00-12345678901234567890123456789012-abcdefabcdefabcd-01' },
    };
    const res = { statusCode: 202, setHeader: jest.fn() };
    const handler = createHandler(of(null));

    const result$ = interceptor.intercept(createExecutionContext(req, res), handler);
    await expect(lastValueFrom(result$)).resolves.toBeNull();

    expect(ctxMock.create).toHaveBeenCalledWith('12345678901234567890123456789012', undefined);
    expect(res.setHeader).toHaveBeenCalledWith('x-trace-id', '12345678901234567890123456789012');
    expect(logMock.start).toHaveBeenCalledWith('http.request', {
      module: 'Http',
      http: { method: 'POST', url: '/jobs?cursor=1' },
      msg: 'POST /jobs?cursor=1',
    });
  });

  it('logs error when downstream handler fails and propagates the exception', async () => {
    const req = {
      method: 'PATCH',
      url: '/orders/1',
      headers: {},
    };
    const res = { statusCode: 500, setHeader: jest.fn() };
    const handler = createHandler(
      throwError(() => Object.assign(new Error('boom'), { status: 500 })),
    );

    const execution = interceptor.intercept(createExecutionContext(req, res), handler);
    await expect(lastValueFrom(execution)).rejects.toThrow('boom');

    expect(logMock.error).toHaveBeenCalledWith('http.request', expect.any(Error), {
      http: { status: 500 },
    });
    expect(logMock.finish).not.toHaveBeenCalled();
  });
});

