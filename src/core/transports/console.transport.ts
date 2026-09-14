import type { LogEvent, LogLevel } from '../log.types';
import { safeStringify } from '../utils/safe-stringify';
import type { LoggerTransport } from './transport.interface';

export interface ConsoleTransportOptions {
  readonly stream?: NodeJS.WritableStream;
  readonly minLevel?: LogLevel;
  readonly name?: string;
}

/**
 * Configurable console transport. Defaults to stderr warn+.
 */
export class ConsoleTransport implements LoggerTransport {
  readonly minLevel?: LogLevel;
  readonly name: string;
  private readonly stream: NodeJS.WritableStream;

  constructor(options: ConsoleTransportOptions = {}) {
    this.stream = options.stream ?? process.stderr;
    this.minLevel = options.minLevel ?? 'warn';
    this.name = options.name ?? (this.stream === process.stdout ? 'console-stdout' : 'console-stderr');
  }

  log(event: LogEvent): void {
    this.stream.write(`${safeStringify(event)}\n`);
  }

  async flush(): Promise<void> {
    // Console streams flush synchronously; method exposed for interface completeness.
  }

  async dispose(): Promise<void> {
    // Streams are managed by Node; provided for symmetry with other transports.
  }
}
