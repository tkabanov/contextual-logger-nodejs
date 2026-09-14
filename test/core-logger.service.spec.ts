import {
  CoreLoggerService,
  type LogEvent,
  type LoggerProcessor,
  type LoggerTransport,
  type LogLevel,
} from '../src';

class RecordingTransport implements LoggerTransport {
  public readonly name = 'recording';
  public readonly events: LogEvent[] = [];
  public readonly handledByLevel: Record<LogLevel, LogEvent[]> = {
    debug: [],
    info: [],
    warn: [],
    error: [],
    fatal: [],
  };

  constructor(
    public readonly minLevel?: LogLevel,
    logByLevel?: Partial<Record<LogLevel, (event: LogEvent) => void | Promise<void>>>,
  ) {
    this.logByLevel = logByLevel;
  }

  logByLevel?: Partial<Record<LogLevel, (event: LogEvent) => void | Promise<void>>>;

  log = jest.fn((event: LogEvent) => {
    this.events.push(event);
    return Promise.resolve();
  });

  flush = jest.fn(() => Promise.resolve());

  dispose = jest.fn(() => Promise.resolve());
}

class UppercaseMessageProcessor implements LoggerProcessor {
  readonly name = 'uppercase';

  handle(event: LogEvent): LogEvent {
    return {
      ...event,
      msg: event.msg?.toUpperCase(),
    };
  }
}

const baseEvent: LogEvent = {
  level: 'info',
  time: '2023-01-01T00:00:00.000Z',
  traceId: 'trace-1',
  event: 'test.event',
};

function createEvent(partial: Partial<LogEvent> = {}): LogEvent {
  return { ...baseEvent, ...partial };
}

async function waitForDispatch(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('CoreLoggerService', () => {
  it('applies processors before forwarding to transports', async () => {
    const transport = new RecordingTransport();
    const processor = new UppercaseMessageProcessor();
    const logger = new CoreLoggerService([transport], [processor]);
    const handleSpy = jest.spyOn(processor, 'handle');

    logger.emit(createEvent({ msg: 'hello world' }));
    await waitForDispatch();

    expect(handleSpy).toHaveBeenCalledTimes(1);
    expect(transport.events).toHaveLength(1);
    expect(transport.events[0]?.msg).toBe('HELLO WORLD');
  });

  it('skips transports that do not meet min level', async () => {
    const transport = new RecordingTransport('error');
    const logger = new CoreLoggerService([transport]);

    logger.emit(createEvent({ level: 'info' }));
    await waitForDispatch();
    expect(transport.events).toHaveLength(0);

    logger.emit(createEvent({ level: 'error', msg: 'boom' }));
    await waitForDispatch();
    expect(transport.events).toHaveLength(1);
    expect(transport.events[0]?.level).toBe('error');
  });

  it('prefers level-specific handlers over generic log()', async () => {
    const infoHandler = jest.fn((event: LogEvent) => {
      transport.handledByLevel[event.level].push(event);
      return Promise.resolve();
    });
    const transport = new RecordingTransport(undefined, { info: infoHandler });
    const logger = new CoreLoggerService([transport]);

    logger.emit(createEvent({ level: 'info', msg: 'custom' }));
    await waitForDispatch();

    expect(infoHandler).toHaveBeenCalledTimes(1);
    expect(transport.log).not.toHaveBeenCalled();
    expect(transport.handledByLevel.info).toHaveLength(1);
    expect(transport.handledByLevel.info[0]?.msg).toBe('custom');
  });

  it('provides child loggers that stamp module name', async () => {
    const transport = new RecordingTransport();
    const logger = new CoreLoggerService([transport]);

    const child = logger.child('UsersService');
    child.info('user created', { traceId: 'trace-2', event: 'user.created' });
    await waitForDispatch();

    expect(transport.events).toHaveLength(1);
    expect(transport.events[0]?.module).toBe('UsersService');
    expect(transport.events[0]?.msg).toBe('user created');
  });

  it('flushes and disposes transports on module destroy', async () => {
    const transport = new RecordingTransport();
    const logger = new CoreLoggerService([transport]);

    await logger.close();

    expect(transport.flush).toHaveBeenCalledTimes(1);
    expect(transport.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps flushing the remaining transports when one fails on close', async () => {
    const faulty: LoggerTransport = {
      name: 'faulty',
      log: jest.fn(),
      flush: jest.fn(() => Promise.reject(new Error('flush failed'))),
      dispose: jest.fn(() => Promise.resolve()),
    };
    const healthy = new RecordingTransport();
    const onError = jest.fn();
    const logger = new CoreLoggerService([faulty, healthy], [], onError);

    await expect(logger.close()).resolves.toBeUndefined();

    expect(faulty.dispose).toHaveBeenCalledTimes(1);
    expect(healthy.flush).toHaveBeenCalledTimes(1);
    expect(healthy.dispose).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(faulty, expect.objectContaining({ message: 'flush failed' }));
  });

  it('falls back to stderr when the error handler itself throws', async () => {
    const faulty: LoggerTransport = {
      name: 'faulty',
      log: () => {
        throw new Error('boom');
      },
    };
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = new CoreLoggerService([faulty], [], () => {
      throw new Error('handler exploded');
    });

    logger.emit(createEvent({ msg: 'trigger' }));
    await waitForDispatch();

    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('Error in logger transport "faulty": Error: boom'),
    );
    stderr.mockRestore();
  });

  it('invokes error handler when transport fails', async () => {
    const faulty: LoggerTransport = {
      name: 'faulty',
      log: () => {
        throw new Error('boom');
      },
    };
    const onError = jest.fn();
    const logger = new CoreLoggerService([faulty], [], onError);

    logger.emit(createEvent({ msg: 'trigger' }));
    await waitForDispatch();

    expect(onError).toHaveBeenCalledWith(faulty, expect.any(Error));
  });
});
