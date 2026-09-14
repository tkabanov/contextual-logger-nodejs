import type { LogEvent } from '../src';
import { SanitizeProcessor } from '../src';

describe('SanitizeProcessor', () => {
  const processor = new SanitizeProcessor();

  const event: LogEvent = {
    level: 'info',
    time: '2023-04-01T10:00:00.000Z',
    traceId: 'trace-xyz',
    event: 'user.login',
    extra: {
      nested: {
        password: 'secret123',
        token: 'abcd',
        safe: 'value',
      } as Record<string, unknown>,
      token: 'top-secret',
    } as Record<string, unknown>,
    user: {
      id: 'user-1',
    },
  };

  it('redacts sensitive keys recursively', () => {
    const result = processor.handle(event);

    const nested = result.extra?.nested as Record<string, unknown> | undefined;
    expect(nested?.password).toBe('[REDACTED]');
    expect(nested?.token).toBe('[REDACTED]');
    expect(nested?.safe).toBe('value');
    expect(result.extra?.token).toBe('[REDACTED]');
  });

  it('preserves Error details instead of flattening them to {}', () => {
    const cause = new Error('root cause');
    const err = Object.assign(new TypeError('outer'), { cause, code: 'E_OUTER', token: 'leak' });
    const result = processor.handle({ ...event, extra: { err } });

    expect(result.extra?.err).toEqual({
      name: 'TypeError',
      message: 'outer',
      stack: err.stack,
      cause: { name: 'Error', message: 'root cause', stack: cause.stack },
      code: 'E_OUTER',
      token: '[REDACTED]',
    });
  });

  it('serialises Map, Set and binary data', () => {
    const result = processor.handle({
      ...event,
      extra: {
        map: new Map<string, unknown>([
          ['safe', 1],
          ['password', 'pw'],
        ]),
        set: new Set(['a', { token: 't' }]),
        buf: Buffer.from('hello'),
        view: new Uint8Array(3),
      },
    });

    expect(result.extra).toEqual({
      map: { safe: 1, password: '[REDACTED]' },
      set: ['a', { token: '[REDACTED]' }],
      buf: '[Buffer 5 bytes]',
      view: '[Uint8Array 3 bytes]',
    });
  });

  it('handles circular references', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    const result = processor.handle({ ...event, extra: { circular } });
    const out = result.extra?.circular as Record<string, unknown>;
    expect(out.self).toBe(out);
  });

  it('does not mutate original event', () => {
    const snapshot = JSON.parse(JSON.stringify(event));
    processor.handle(event);

    expect(event).toEqual(snapshot);
  });
});
