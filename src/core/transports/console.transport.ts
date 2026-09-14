import { once } from 'node:events';

import type { LogEvent, LogLevel } from '../log.types';
import { safeStringify } from '../utils/safe-stringify';
import type { LoggerTransport } from './transport.interface';

export interface ConsoleTransportOptions {
  readonly stream?: NodeJS.WritableStream;
  readonly minLevel?: LogLevel;
  readonly name?: string;
  /** How long `flush()` waits for a saturated stream to drain. Defaults to 1000 ms. */
  readonly drainTimeoutMs?: number;
}

/**
 * Line-delimited JSON to a writable stream. Defaults to stderr, warn+.
 *
 * Writes are fire-and-forget (a logger must not block the caller), but the
 * stream's backpressure is honoured on shutdown: `flush()` waits until a
 * saturated stream has drained, so buffered lines reach a slow pipe before the
 * process exits.
 */
export class ConsoleTransport implements LoggerTransport {
  readonly minLevel?: LogLevel;
  readonly name: string;
  private readonly stream: NodeJS.WritableStream;
  private readonly drainTimeoutMs: number;
  private needsDrain = false;

  constructor(options: ConsoleTransportOptions = {}) {
    this.stream = options.stream ?? process.stderr;
    this.minLevel = options.minLevel ?? 'warn';
    this.name = options.name ?? (this.stream === process.stdout ? 'console-stdout' : 'console-stderr');
    this.drainTimeoutMs = options.drainTimeoutMs ?? 1000;
  }

  log(event: LogEvent): void {
    const ok = this.stream.write(`${safeStringify(event)}\n`);
    if (!ok && !this.needsDrain) {
      this.needsDrain = true;
      this.stream.once('drain', () => {
        this.needsDrain = false;
      });
    }
  }

  async flush(): Promise<void> {
    if (!this.needsDrain) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.drainTimeoutMs);
    try {
      await once(this.stream, 'drain', { signal: controller.signal });
    } catch {
      // Timed out or the stream errored: shutdown must not hang on a stuck pipe.
    } finally {
      clearTimeout(timer);
    }
  }

  async dispose(): Promise<void> {
    // Streams are managed by Node; provided for symmetry with other transports.
  }
}
