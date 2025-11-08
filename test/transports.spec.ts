import type { LogEvent } from '../src';
import { ConsoleTransport } from '../src';

describe('ConsoleTransport', () => {
  let writeSpy: jest.SpyInstance;
  let transport: ConsoleTransport;
  const baseEvent: LogEvent = {
    level: 'info',
    time: '2023-01-01T00:00:00.000Z',
    traceId: 'trace',
    event: 'test',
  };

  beforeEach(() => {
    transport = new ConsoleTransport();
    writeSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to stderr with warn threshold', () => {
    expect(transport.minLevel).toBe('warn');
    expect(transport.name).toBe('console-stderr');

    transport.log({ ...baseEvent, level: 'warn', msg: 'warn message' });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0]?.[0]).toContain('warn');
  });

  it('supports custom streams and names', () => {
    const write = jest.fn().mockReturnValue(true);
    const fakeStream = {
      write,
    } as unknown as NodeJS.WritableStream;

    const custom = new ConsoleTransport({ stream: fakeStream, minLevel: 'debug', name: 'console-custom' });

    custom.log({ ...baseEvent, level: 'debug', msg: 'hello' });

    expect(custom.minLevel).toBe('debug');
    expect(custom.name).toBe('console-custom');
    expect(write).toHaveBeenCalledWith(expect.stringContaining('"debug"'));
  });

  it('exposes flush and dispose hooks', async () => {
    await expect(transport.flush()).resolves.toBeUndefined();
    await expect(transport.dispose()).resolves.toBeUndefined();
  });
});
