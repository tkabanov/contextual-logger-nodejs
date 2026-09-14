import type { Server } from 'node:http';

import {
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  Injectable,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  HttpContextInterceptor,
  HttpContextMiddleware,
  type LogEvent,
  LoggerModule,
  type LoggerTransport,
  OpContextService,
  OpLogged,
  OpLoggerService,
} from '../src';

class MemoryTransport implements LoggerTransport {
  readonly name = 'memory';
  readonly events: LogEvent[] = [];
  log(event: LogEvent): void {
    this.events.push(event);
  }
}

/** Runs before the interceptor: proves the middleware already established the trace. */
@Injectable()
class LoggingGuard implements CanActivate {
  constructor(private readonly log: OpLoggerService) {}
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: { id?: string } }>();
    req.user = { id: 'user-from-guard' };
    this.log.point('info', 'guard.check');
    return true;
  }
}

@Injectable()
class OrdersService {
  constructor(
    readonly log: OpLoggerService,
    readonly opCtx: OpContextService,
  ) {}

  @OpLogged('orders.create', { module: 'OrdersService' })
  async create(delayMs: number): Promise<{ trace?: string }> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    this.log.point('info', 'orders.create', { msg: 'inside service' });
    return { trace: this.opCtx.traceId() };
  }
}

@Controller()
class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders/:delay')
  create(@Param('delay') delay: string) {
    return this.orders.create(Number(delay));
  }

  @Get('missing')
  missing(): never {
    throw new NotFoundException('nothing here');
  }
}

const transport = new MemoryTransport();

@Module({
  imports: [LoggerModule.forRoot({ transports: [transport] })],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    { provide: APP_GUARD, useClass: LoggingGuard },
    { provide: APP_INTERCEPTOR, useClass: HttpContextInterceptor },
  ],
})
class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpContextMiddleware).forRoutes('*');
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('NestJS end-to-end', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let server: Server;
  let ctx: OpContextService;

  async function createApp() {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const nestApp = moduleRef.createNestApplication();
    await nestApp.init();
    return nestApp;
  }

  beforeAll(async () => {
    app = await createApp();
    server = app.getHttpServer() as Server;
    ctx = app.get(OpContextService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    transport.events.length = 0;
  });

  const byTrace = (traceId: string) => transport.events.filter((e) => e.traceId === traceId);

  it('propagates one trace through middleware, guard, interceptor, decorator and service', async () => {
    const res = await request(server).get('/orders/5').set('x-trace-id', 'trace-e2e').expect(200);
    await flush();

    expect(res.headers['x-trace-id']).toBe('trace-e2e');
    expect(res.body).toEqual({ trace: 'trace-e2e' }); // ALS visible inside the service

    const events = byTrace('trace-e2e');
    expect(events.map((e) => `${e.event}:${e.kind ?? ''}`)).toEqual([
      'guard.check:point',
      'http.request:start',
      'orders.create:start',
      'orders.create:point',
      'orders.create:finish',
      'http.request:finish',
    ]);
    expect(transport.events).toHaveLength(events.length); // nothing logged under another trace

    const http = events.find((e) => e.event === 'http.request' && e.kind === 'start')!;
    const op = events.find((e) => e.event === 'orders.create' && e.kind === 'start')!;
    const opFinish = events.find((e) => e.event === 'orders.create' && e.kind === 'finish')!;
    expect(op.parentOpId).toBe(http.opId);
    expect(opFinish.parentOpId).toBe(http.opId);
    expect(opFinish.durMs).toBeGreaterThanOrEqual(4);
    expect(events.find((e) => e.event === 'http.request' && e.kind === 'finish')?.http).toEqual({
      status: 200,
    });

    // The guard runs before the interceptor, yet already sees the trace; the user it
    // attaches is picked up by the interceptor for the remaining records.
    expect(events[0].extra?.orphanOp).toBe(true);
    expect(events.slice(1).every((e) => e.user?.id === 'user-from-guard')).toBe(true);
  });

  it('keeps concurrent requests isolated and leaves no store behind', async () => {
    const [slow, fast] = await Promise.all([
      request(server).get('/orders/40').set('x-trace-id', 'trace-slow'),
      request(server).get('/orders/1').set('x-trace-id', 'trace-fast'),
    ]);
    await flush();

    expect(slow.body).toEqual({ trace: 'trace-slow' });
    expect(fast.body).toEqual({ trace: 'trace-fast' });
    expect(byTrace('trace-slow')).toHaveLength(6);
    expect(byTrace('trace-fast')).toHaveLength(6);
    expect(transport.events).toHaveLength(12);
    expect(ctx.get()).toBeUndefined();
  });

  it('logs HttpException failures with their status and still returns the framework response', async () => {
    const res = await request(server).get('/missing').set('x-trace-id', 'trace-404').expect(404);
    await flush();

    expect(res.headers['x-trace-id']).toBe('trace-404');
    const error = byTrace('trace-404').find((e) => e.kind === 'error')!;
    expect(error.event).toBe('http.request');
    expect(error.http).toEqual({ status: 404 });
    expect(error.err).toEqual(expect.objectContaining({ name: 'NotFoundException', status: 404 }));
    expect(byTrace('trace-404').some((e) => e.kind === 'finish')).toBe(false);
  });

  it('generates a trace id when the client sends none or an invalid one', async () => {
    const res = await request(server).get('/orders/1').set('x-trace-id', 'not valid!').expect(200);
    await flush();

    const traceId = res.headers['x-trace-id'];
    expect(traceId).toHaveLength(36);
    expect(res.body).toEqual({ trace: traceId });
  });
});
