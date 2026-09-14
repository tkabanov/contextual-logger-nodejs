import type { LogEvent } from '../src';
import * as root from '../src';
import * as core from '../src/core';
import { type SentryClientLike, SentryTransport } from '../src/transports/sentry';

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  flush: jest.fn().mockResolvedValue(true),
}));

// Same object the transport captured via `import * as Sentry`.
const sdk = jest.requireMock<{ captureException: jest.Mock; captureMessage: jest.Mock; flush: jest.Mock }>(
  '@sentry/node',
);

const baseEvent: LogEvent = {
  level: 'error',
  time: '2024-01-01T00:00:00.000Z',
  traceId: 'trace-1',
  opId: 'op-1',
  parentOpId: 'op-0',
  event: 'orders.create',
  module: 'Orders',
  code: 'E_DUP',
  user: { id: 'u-1' },
  http: { method: 'POST', url: '/orders', status: 500 },
  extra: { attempt: 2 },
};

describe('SentryTransport', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is not part of the root or core entry points', () => {
    expect('SentryTransport' in root).toBe(false);
    expect('SentryTransport' in core).toBe(false);
  });

  it('defaults to @sentry/node, minLevel error and name sentry', () => {
    const transport = new SentryTransport();
    expect(transport.name).toBe('sentry');
    expect(transport.minLevel).toBe('error');

    transport.log({
      ...baseEvent,
      kind: 'error',
      err: { name: 'DupError', message: 'dup', stack: 'DupError: dup\n    at x' },
    });

    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    const [error, context] = sdk.captureException.mock.calls[0] as [Error, Record<string, unknown>];
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DupError');
    expect(error.message).toBe('dup');
    expect(error.stack).toBe('DupError: dup\n    at x');
    expect(context).toEqual({
      level: 'error',
      tags: {
        traceId: 'trace-1',
        event: 'orders.create',
        opId: 'op-1',
        parentOpId: 'op-0',
        module: 'Orders',
        code: 'E_DUP',
        kind: 'error',
      },
      extra: {
        time: '2024-01-01T00:00:00.000Z',
        http: { method: 'POST', url: '/orders', status: 500 },
        attempt: 2,
      },
      user: { id: 'u-1' },
    });
  });

  it('sends events without an error payload as messages with mapped severity', () => {
    const transport = new SentryTransport({ minLevel: 'debug' });

    transport.log({ ...baseEvent, level: 'warn', kind: 'point', msg: 'slow query', durMs: 1200 });

    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(sdk.captureMessage).toHaveBeenCalledWith(
      'slow query',
      expect.objectContaining({
        level: 'warning',
        extra: expect.objectContaining({ msg: 'slow query', durMs: 1200 }),
      }),
    );
  });

  it('maps fatal to fatal and falls back to the event name as message', () => {
    new SentryTransport().log({ level: 'fatal', time: 't', traceId: 't', event: 'process.crash' });

    expect(sdk.captureMessage).toHaveBeenCalledWith(
      'process.crash',
      expect.objectContaining({ level: 'fatal' }),
    );
  });

  it('can be told to ignore non-error events', () => {
    new SentryTransport({ captureMessages: false }).log({ ...baseEvent, kind: 'point' });

    expect(sdk.captureMessage).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it('accepts a custom client and flushes it with the configured timeout', async () => {
    const client: SentryClientLike = {
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      flush: jest.fn().mockResolvedValue(true),
    };
    const transport = new SentryTransport({ client, flushTimeoutMs: 500, name: 'sentry-custom' });

    transport.log({ ...baseEvent, err: { message: 'boom' } });
    await transport.flush();
    await transport.dispose();

    expect(transport.name).toBe('sentry-custom');
    expect(client.captureException).toHaveBeenCalledTimes(1);
    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(client.flush).toHaveBeenCalledTimes(2);
    expect(client.flush).toHaveBeenCalledWith(500);
  });

  it('tolerates a client without flush', async () => {
    const client: SentryClientLike = { captureException: jest.fn(), captureMessage: jest.fn() };
    await expect(new SentryTransport({ client }).flush()).resolves.toBeUndefined();
  });
});
