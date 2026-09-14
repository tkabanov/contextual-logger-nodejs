import { Writable } from 'node:stream';

import { ConsoleTransport, type LogEvent } from '../src';

const event = (msg: string): LogEvent => ({ level: 'error', time: 't', traceId: 'tr', event: 'e', msg });

describe('ConsoleTransport backpressure', () => {
  it('flush() waits until a saturated stream has drained', async () => {
    const chunks: string[] = [];
    let release: (() => void) | undefined;
    const slow = new Writable({
      highWaterMark: 1,
      write(chunk, _enc, cb) {
        chunks.push(String(chunk));
        release = cb; // hold the stream until the test lets go
      },
    });
    const transport = new ConsoleTransport({ stream: slow, drainTimeoutMs: 5000 });

    transport.log(event('one'));
    transport.log(event('two'));

    let flushed = false;
    const flushing = transport.flush().then(() => {
      flushed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(flushed).toBe(false);

    // Let the stream process everything: buffered 'two' is written, then 'drain' fires.
    release?.();
    await new Promise((resolve) => setImmediate(resolve));
    release?.();
    await flushing;

    expect(flushed).toBe(true);
    expect(chunks.join('')).toContain('"msg":"one"');
    expect(chunks.join('')).toContain('"msg":"two"');
  });

  it('flush() gives up after drainTimeoutMs on a stuck stream', async () => {
    const stuck = new Writable({
      highWaterMark: 1,
      write() {
        /* never calls back */
      },
    });
    const transport = new ConsoleTransport({ stream: stuck, drainTimeoutMs: 20 });
    transport.log(event('lost'));

    const started = Date.now();
    await expect(transport.flush()).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('flush() is immediate when the stream never pushed back', async () => {
    const fine = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    const transport = new ConsoleTransport({ stream: fine });
    transport.log(event('ok'));
    await expect(transport.flush()).resolves.toBeUndefined();
  });
});
