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

  it('redacts bearer tokens and JWTs inside string values by default', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const result = processor.handle({
      ...event,
      msg: `auth failed for Bearer abc.def-123 and ${jwt}`,
      extra: { header: 'Bearer xyz', plain: 'nothing here' },
    });

    expect(result.msg).toBe('auth failed for [REDACTED] and [REDACTED]');
    expect(result.extra).toEqual({ header: '[REDACTED]', plain: 'nothing here' });
  });

  it('supports custom keys, replacement text and disabling value patterns', () => {
    const custom = new SanitizeProcessor({
      keys: ['internalNote'],
      valuePatterns: [],
      replacement: '***',
    });
    const result = custom.handle({
      ...event,
      msg: 'Bearer keep-me',
      extra: { internal_note: 'hidden', password: 'still-default', ok: 1 },
    });

    expect(result.msg).toBe('Bearer keep-me');
    expect(result.extra).toEqual({ internal_note: '***', password: '***', ok: 1 });
  });

  it('can replace the default key list entirely', () => {
    const only = new SanitizeProcessor({ keys: ['secretSauce'], extendDefaults: false });
    const result = only.handle({ ...event, extra: { password: 'visible', secret_sauce: 'x' } });

    expect(result.extra).toEqual({ password: 'visible', secret_sauce: '[REDACTED]' });
  });

  it('does not mutate original event', () => {
    const snapshot = JSON.parse(JSON.stringify(event));
    processor.handle(event);

    expect(event).toEqual(snapshot);
  });
});
