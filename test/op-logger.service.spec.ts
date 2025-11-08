import { BadRequestException } from '@nestjs/common';
import type { LogEvent } from '../src';
import { CoreLoggerService, OpContextService, OpLoggerService } from '../src';

class ArrayTransport {
  public readonly name = 'array';
  public readonly events: LogEvent[] = [];

  log(event: LogEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

async function waitForDispatch(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('OpLoggerService', () => {
  let context: OpContextService;
  let transport: ArrayTransport;
  let core: CoreLoggerService;
  let service: OpLoggerService;

  beforeEach(() => {
    context = new OpContextService();
    transport = new ArrayTransport();
    core = new CoreLoggerService([transport]);
    service = new OpLoggerService(context, core);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const runWithContext = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    return context.run('trace-abc', () => {
      context.setUser('user-123');
      return fn();
    });
  };

  it('emits start events with trace and user info', async () => {
    await runWithContext(async () => {
      service.start('orders.create', { module: 'OrdersService', msg: 'starting' });
      await waitForDispatch();

      expect(transport.events).toHaveLength(1);
      const event = transport.events[0];
      expect(event.kind).toBe('start');
      expect(event.traceId).toBe('trace-abc');
      expect(event.user?.id).toBe('user-123');
      expect(event.module).toBe('OrdersService');
      expect(context.currentOp()).toBe(event.opId);
    });
  });

  it('emits finish events including duration', async () => {
    await runWithContext(async () => {
      service.start('orders.create');
      await waitForDispatch();

      service.finish('orders.create', { http: { status: 201 } });
      await waitForDispatch();

      const finishEvent = transport.events.find((e) => e.kind === 'finish');
      expect(finishEvent).toBeDefined();
      expect(finishEvent?.http?.status).toBe(201);
      expect(finishEvent?.durMs).toEqual(expect.any(Number));
      expect((finishEvent?.durMs ?? 0) >= 0).toBe(true);
      expect(context.currentOp()).toBeUndefined();
    });
  });

  it('emits point events and marks orphan operations', async () => {
    await runWithContext(async () => {
      context.endOp(); // ensure no current op
      service.point('warn', 'cache.miss', { msg: 'Cache miss', extra: { key: 'user:1' } });
      await waitForDispatch();

      const pointEvent = transport.events[0];
      expect(pointEvent.kind).toBe('point');
      expect(pointEvent.level).toBe('warn');
      expect(pointEvent.extra?.orphanOp).toBe(true);
      expect(pointEvent.extra?.key).toBe('user:1');
    });
  });

  it('normalises errors and emits error events', async () => {
    await runWithContext(async () => {
      service.start('orders.create');
      await waitForDispatch();

      const error = new Error('boom');
      service.error('orders.create', error, { module: 'OrdersService' });
      await waitForDispatch();

      const errorEvent = transport.events.find((e) => e.kind === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.err?.message).toBe('boom');
      expect(errorEvent?.module).toBe('OrdersService');
    });
  });

  it('supports legacy log signature', async () => {
    await runWithContext(async () => {
      service.log('legacy message', 'LegacyModule', { foo: 'bar' });
      await waitForDispatch();

      const legacyEvent = transport.events[0];
      expect(legacyEvent.event).toBe('info');
      expect(legacyEvent.msg).toBe('legacy message');
      expect(legacyEvent.module).toBe('LegacyModule');
      expect(legacyEvent.extra?.args).toBeDefined();
    });
  });

  it('allows manual context seeding outside ALS scope', async () => {
    service.seed('trace-manual', { userId: 'user-seeded' });
    service.point('info', 'manual.point', { msg: 'manual' });
    await waitForDispatch();

    const seededEvent = transport.events[0];
    expect(seededEvent.traceId).toBe('trace-manual');
    expect(seededEvent.user?.id).toBe('user-seeded');
    expect(seededEvent.extra?.orphanOp).toBe(true);

    service.setUser('user-updated');
    service.point('info', 'manual.point.update');
    await waitForDispatch();

    const secondEvent = transport.events[1];
    expect(secondEvent.user?.id).toBe('user-updated');
  });

  it('auto-seeds a trace when none exists', async () => {
    const createSpy = jest.spyOn(context, 'create');
    const enterSpy = jest.spyOn(context, 'enter');
    service.point('info', 'auto.seed', { msg: 'auto' });
    await waitForDispatch();

    expect(createSpy).toHaveBeenCalledTimes(1);
    const [generatedTrace] = createSpy.mock.calls[0];
    expect(typeof generatedTrace).toBe('string');
    expect(generatedTrace).toHaveLength(36);
    expect(enterSpy).toHaveBeenCalledWith(expect.objectContaining({ traceId: generatedTrace }));
    expect(context.traceId()).toBe(generatedTrace);
    const event = transport.events[0];
    expect(event.traceId).toBe(generatedTrace);
    expect(event.extra?.orphanOp).toBe(true);

    createSpy.mockRestore();
    enterSpy.mockRestore();
  });

  it('normalises BadRequestException in structured error events', async () => {
    await runWithContext(async () => {
      service.start('orders.create');
      await waitForDispatch();

      const badReq = new BadRequestException({ reason: 'invalid' });
      service.error('orders.create', badReq, { module: 'OrdersService' });
      await waitForDispatch();

      const errorEvent = transport.events.find((e) => e.kind === 'error');
      expect(errorEvent?.err).toEqual({
        name: badReq.name,
        message: badReq.message,
        response: badReq.getResponse(),
      });
    });
  });

  it('handles legacy error overload with Error instances and stack traces', async () => {
    await runWithContext(async () => {
      const legacyError = new Error('legacy-failure');
      legacyError.stack = 'Error: legacy-failure\n    at test';
      service.error(legacyError, 'LegacyModule', legacyError.stack, { foo: 'bar' });
      await waitForDispatch();

      const legacyEvent = transport.events.find((e) => e.kind === 'point' && e.event === 'error');
      expect(legacyEvent).toBeDefined();
      expect(legacyEvent?.module).toBe('LegacyModule');
      expect(legacyEvent?.extra?.args).toEqual([{ foo: 'bar' }]);
      expect(legacyEvent?.extra?.err).toEqual(
        expect.objectContaining({ message: 'legacy-failure', stack: legacyError.stack }),
      );
    });
  });

  it('logs legacy string errors when called without structured params', async () => {
    await runWithContext(async () => {
      service.error('legacy failure message');
      await waitForDispatch();

      const event = transport.events.find((e) => e.kind === 'point' && e.event === 'error');
      expect(event?.msg).toBe('legacy failure message');
      expect(event?.extra?.args).toBeUndefined();
    });
  });

  it('emits legacy helper levels (warn/debug/verbose/fatal)', async () => {
    await runWithContext(async () => {
      service.warn('warn message', 'WarnModule');
      service.debug({ debug: true });
      service.verbose('verbose message', 'VerboseModule');
      service.fatal('fatal message', 'FatalModule');
      await waitForDispatch();

      const warnEvent = transport.events.find((e) => e.event === 'warn');
      expect(warnEvent?.level).toBe('warn');
      expect(warnEvent?.module).toBe('WarnModule');

      const debugEvent = transport.events.find((e) => e.event === 'debug');
      expect(debugEvent?.msg).toBe(JSON.stringify({ debug: true }));

      const verboseEvent = transport.events.find((e) => e.module === 'VerboseModule');
      expect(verboseEvent?.level).toBe('debug');

      const fatalEvent = transport.events.find((e) => e.event === 'fatal');
      expect(fatalEvent?.level).toBe('fatal');
      expect(fatalEvent?.module).toBe('FatalModule');
    });
  });

  it('handles non-serialisable error payloads gracefully', async () => {
    await runWithContext(async () => {
      const circular: Record<string, unknown> & { self?: unknown } = {};
      circular.self = circular;

      service.error('orders.create', circular);
      await waitForDispatch();

      const errorEvent = transport.events.find((e) => e.kind === 'error');
      expect(errorEvent?.msg).toBe('Unknown error');
      expect(errorEvent?.err).toEqual({ name: 'Error', message: 'Unknown error' });
    });
  });

  it('falls back to string coercion when legacy log message cannot be JSON stringified', async () => {
    await runWithContext(async () => {
      const circular: Record<string, unknown> & { self?: unknown } = {};
      circular.self = circular;

      service.log(circular);
      await waitForDispatch();

      const legacyEvent = transport.events.find((e) => e.event === 'info');
      expect(legacyEvent?.msg).toBe('[object Object]');
    });
  });
});
