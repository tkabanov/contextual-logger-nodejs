import { Writable } from 'node:stream';

import { ConsoleTransport, type LogEvent, safeStringify } from '../src';

describe('safeStringify', () => {
  it('handles circular references, bigint, Error, Map, Set, functions and symbols', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const err = Object.assign(new RangeError('bad'), { code: 'E_RANGE' });

    const out = JSON.parse(
      safeStringify({
        circular,
        big: 10n,
        err,
        map: new Map([['k', 1]]),
        set: new Set([1, 2]),
        fn: function named() {},
        sym: Symbol('s'),
      }),
    ) as Record<string, unknown>;

    expect(out.circular).toEqual({ a: 1, self: '[Circular]' });
    expect(out.big).toBe('10');
    expect(out.err).toEqual({ name: 'RangeError', message: 'bad', stack: err.stack, code: 'E_RANGE' });
    expect(out.map).toEqual({ k: 1 });
    expect(out.set).toEqual([1, 2]);
    expect(out.fn).toBe('[Function named]');
    expect(out.sym).toBe('Symbol(s)');
  });

  it('never throws, even when a getter does', () => {
    const hostile = {
      get boom(): string {
        throw new Error('getter exploded');
      },
    };
    expect(JSON.parse(safeStringify(hostile))).toEqual({ unserializable: true, error: 'getter exploded' });
  });

  it('is used by ConsoleTransport so a circular extra does not lose the line', () => {
    let written = '';
    const stream = new Writable({
      write(chunk, _enc, cb) {
        written += String(chunk);
        cb();
      },
    });
    const transport = new ConsoleTransport({ stream, minLevel: 'debug' });
    const extra: Record<string, unknown> = {};
    extra.self = extra;
    const event: LogEvent = { level: 'info', time: 't', traceId: 'tr', event: 'e', extra };

    expect(() => transport.log(event)).not.toThrow();
    expect(JSON.parse(written) as LogEvent).toEqual(
      expect.objectContaining({ event: 'e', extra: { self: '[Circular]' } }),
    );
  });
});
