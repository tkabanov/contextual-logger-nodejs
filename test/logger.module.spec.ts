import { Injectable, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  ConsoleTransport,
  CoreLoggerService,
  type LogEvent,
  LOGGER_ERROR_HANDLER,
  LOGGER_OPTIONS,
  LOGGER_PROCESSORS,
  LOGGER_TRANSPORTS,
  LoggerModule,
  type LoggerModuleOptions,
  type LoggerProcessor,
  type LoggerTransport,
  OpLoggerService,
} from '../src';

const getTransports = (moduleRef: TestingModule): LoggerTransport[] =>
  moduleRef.get<LoggerTransport[]>(LOGGER_TRANSPORTS);

const getProcessors = (moduleRef: TestingModule): LoggerProcessor[] =>
  moduleRef.get<LoggerProcessor[]>(LOGGER_PROCESSORS);

describe('LoggerModule', () => {
  it('provides default console transport and empty processors when options are omitted', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot()],
    }).compile();

    const transports = getTransports(moduleRef);
    expect(transports).toHaveLength(1);
    expect(transports[0]).toBeInstanceOf(ConsoleTransport);

    const processors = getProcessors(moduleRef);
    expect(processors).toEqual([]);

    const core = moduleRef.get(CoreLoggerService);
    const logSpy = jest.spyOn(transports[0], 'log').mockImplementation(() => undefined);
    core.error('hello');
    await new Promise((resolve) => setImmediate(resolve));
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', msg: 'hello' }));

    logSpy.mockRestore();
    await moduleRef.close();
  });

  it('wires custom transports, processors, and error handler', async () => {
    const processor: LoggerProcessor = {
      name: 'tagger',
      handle: jest.fn((event: LogEvent) => ({
        ...event,
        extra: { ...(event.extra ?? {}), tagged: true },
      })),
    };

    const transport: LoggerTransport = {
      name: 'memory',
      log: jest.fn(),
    };

    const failingTransport: LoggerTransport = {
      name: 'failing',
      log: jest.fn(() => {
        throw new Error('boom');
      }),
    };

    const onTransportError = jest.fn();

    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          transports: [transport, failingTransport],
          processors: [processor],
          onTransportError,
        }),
      ],
    }).compile();

    const core = moduleRef.get(CoreLoggerService);
    const handler = moduleRef.get<((t: LoggerTransport, err: unknown) => void) | undefined>(
      LOGGER_ERROR_HANDLER,
    );
    expect(handler).toBe(onTransportError);

    core.emit({
      level: 'info',
      kind: 'point',
      event: 'custom',
      time: new Date().toISOString(),
      traceId: 'trace-123',
      msg: 'hello',
    } as LogEvent);
    await new Promise((resolve) => setImmediate(resolve));

    expect(processor.handle).toHaveBeenCalledTimes(1);
    expect(transport.log).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: expect.objectContaining({ tagged: true }),
      }),
    );
    expect(onTransportError).toHaveBeenCalledWith(failingTransport, expect.any(Error));

    await moduleRef.close();
  });

  it('resolves options asynchronously from injected providers (forRootAsync)', async () => {
    @Injectable()
    class FakeConfig {
      get(key: string): string {
        return key === 'LOG_LEVEL' ? 'debug' : '';
      }
    }
    @Module({ providers: [FakeConfig], exports: [FakeConfig] })
    class FakeConfigModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRootAsync({
          imports: [FakeConfigModule],
          inject: [FakeConfig],
          useFactory: async (config: FakeConfig): Promise<LoggerModuleOptions> => {
            await Promise.resolve();
            return {
              transports: [
                new ConsoleTransport({ minLevel: config.get('LOG_LEVEL') as 'debug', name: 'from-config' }),
              ],
            };
          },
        }),
      ],
    }).compile();

    const options = moduleRef.get<LoggerModuleOptions>(LOGGER_OPTIONS);
    expect(options.transports?.[0]?.name).toBe('from-config');
    const transports = getTransports(moduleRef);
    expect(transports[0]?.minLevel).toBe('debug');
    expect(getProcessors(moduleRef)).toEqual([]);
    expect(moduleRef.get(OpLoggerService)).toBeInstanceOf(OpLoggerService);
    expect(moduleRef.get(CoreLoggerService)).toBeInstanceOf(CoreLoggerService);

    await moduleRef.close();
  });

  it('flushes and disposes transports on application shutdown', async () => {
    const transport: LoggerTransport = {
      name: 'lifecycle',
      log: jest.fn(),
      flush: jest.fn(() => Promise.resolve()),
      dispose: jest.fn(() => Promise.resolve()),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ transports: [transport] })],
    }).compile();
    await moduleRef.init();

    expect(moduleRef.get(CoreLoggerService)).toBeInstanceOf(CoreLoggerService);
    await moduleRef.close();

    expect(transport.flush).toHaveBeenCalledTimes(1);
    expect(transport.dispose).toHaveBeenCalledTimes(1);
  });
});
