import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';

import {
  ConsoleTransport,
  CoreLoggerService,
  HttpContextInterceptor,
  OpContextService,
  OpLoggerService,
  SanitizeProcessor,
} from '../src';

type Request = {
  method: string;
  url: string;
  originalUrl?: string;
  headers: Record<string, string>;
  user?: { id?: string };
};

type Response = {
  statusCode: number;
  setHeader: (key: string, value: string) => void;
};

function createExecutionContext(req: Request, res: Response): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => undefined as never,
    }),
    getClass: () => Object,
    getHandler: () => () => undefined,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http' as const,
  } as ExecutionContext;
}

async function simulateRequest(): Promise<void> {
  const ctx = new OpContextService();
  const transport = new ConsoleTransport();
  const core = new CoreLoggerService([transport], [new SanitizeProcessor()]);
  const opLogger = new OpLoggerService(ctx, core);
  const interceptor = new HttpContextInterceptor(ctx, opLogger);

  const request: Request = {
    method: 'GET',
    url: '/health',
    headers: {},
    user: { id: 'user-7' },
  };

  const response: Response = {
    statusCode: 200,
    setHeader: (key, value) => {
      console.log(`response header: ${key}=${value}`);
    },
  };

  const handler: CallHandler = {
    handle: () => of({ ok: true }),
  };

  const observable = interceptor.intercept(createExecutionContext(request, response), handler);
  const result = await lastValueFrom(observable);
  console.log('Response body:', result);
}

async function simulateFailure(): Promise<void> {
  const ctx = new OpContextService();
  const core = new CoreLoggerService([new ConsoleTransport()]);
  const opLogger = new OpLoggerService(ctx, core);
  const interceptor = new HttpContextInterceptor(ctx, opLogger);

  const request: Request = {
    method: 'POST',
    url: '/orders',
    headers: {},
  };

  const response: Response = {
    statusCode: 500,
    setHeader: () => {
      /* no-op */
    },
  };

  const handler: CallHandler = {
    handle: () => throwError(() => new Error('boom')),
  };

  try {
    await lastValueFrom(interceptor.intercept(createExecutionContext(request, response), handler));
  } catch (err) {
    console.error('Caught error:', err instanceof Error ? err.message : err);
  }
}

async function main(): Promise<void> {
  await simulateRequest();
  await simulateFailure();
}

void main();
