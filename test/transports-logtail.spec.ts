import type { LogEvent } from '../src';
import * as root from '../src';
import * as core from '../src/core';
import { LogtailTransport } from '../src/transports/logtail';

const mockClient = {
  debug: jest.fn().mockResolvedValue(undefined),
  info: jest.fn().mockResolvedValue(undefined),
  warn: jest.fn().mockResolvedValue(undefined),
  error: jest.fn().mockResolvedValue(undefined),
  flush: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@logtail/node', () => ({
  Logtail: jest.fn().mockImplementation(() => mockClient),
}));

const baseEvent: LogEvent = {
  level: 'info',
  time: '2023-02-02T02:02:02.000Z',
  traceId: 'trace',
  event: 'something',
};

describe('LogtailTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is not part of the root or core entry points', () => {
    expect('LogtailTransport' in root).toBe(false);
    expect('LogtailTransport' in core).toBe(false);
  });

  it('throws when token or endpoint missing', () => {
    expect(() => new LogtailTransport({ sourceToken: ' ', endpoint: 'host' })).toThrow(
      'LogtailTransport: sourceToken is required',
    );
    expect(() => new LogtailTransport({ sourceToken: 'token', endpoint: '' })).toThrow(
      'LogtailTransport: endpoint is required',
    );
  });

  it('normalises the endpoint and exposes minLevel/name', () => {
    const { Logtail } = jest.requireMock<{ Logtail: jest.Mock }>('@logtail/node');
    const transport = new LogtailTransport({
      sourceToken: 'token',
      endpoint: 'in.logs.betterstack.com',
      minLevel: 'warn',
      name: 'bs',
    });
    expect(transport.minLevel).toBe('warn');
    expect(transport.name).toBe('bs');
    expect(Logtail).toHaveBeenCalledWith('token', { endpoint: 'https://in.logs.betterstack.com' });

    new LogtailTransport({ sourceToken: 'token', endpoint: 'http://localhost:9000' });
    expect(Logtail).toHaveBeenLastCalledWith('token', { endpoint: 'http://localhost:9000' });
  });

  it('routes level-specific calls to client', async () => {
    const transport = new LogtailTransport({ sourceToken: 'token', endpoint: 'example.com' });

    await transport.logByLevel?.info?.({ ...baseEvent, level: 'info' });
    await transport.logByLevel?.error?.({ ...baseEvent, level: 'error', msg: 'e' });

    expect(mockClient.info).toHaveBeenCalledWith('something', expect.objectContaining({ level: 'info' }));
    expect(mockClient.error).toHaveBeenCalledWith('e', expect.objectContaining({ level: 'error' }));
  });

  it('falls back to info call when using log()', async () => {
    const transport = new LogtailTransport({ sourceToken: 'token', endpoint: 'example.com' });

    await transport.log({ ...baseEvent, msg: 'fallback' });

    expect(mockClient.info).toHaveBeenCalledWith(
      'fallback',
      expect.objectContaining({ message: 'fallback' }),
    );
  });

  it('flushes via underlying client', async () => {
    const transport = new LogtailTransport({ sourceToken: 'token', endpoint: 'example.com' });
    await transport.flush?.();
    expect(mockClient.flush).toHaveBeenCalledTimes(1);
  });

  it('disposes by flushing pending events', async () => {
    const transport = new LogtailTransport({ sourceToken: 'token', endpoint: 'example.com' });
    await transport.dispose?.();
    expect(mockClient.flush).toHaveBeenCalledTimes(1);
  });
});
