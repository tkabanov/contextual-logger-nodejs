import { hostname } from 'node:os';

import type { LogEvent } from '../log.types';
import type { LoggerProcessor } from '../logger-processor.interface';

export interface ServiceInfoProcessorOptions {
  /** Logical service name, e.g. `orders-api`. */
  readonly name?: string;
  /** Deployed version, e.g. from `package.json` or a git SHA. */
  readonly version?: string;
  /** Environment name. Defaults to `process.env.NODE_ENV`. */
  readonly env?: string;
  /** Include `os.hostname()` (true, default), a fixed string, or nothing (false). */
  readonly hostname?: boolean | string;
  /** Include `process.pid`. Defaults to true. */
  readonly pid?: boolean;
}

/**
 * Stamps every event with `service: { name, version, env, hostname, pid }`.
 *
 * Values are resolved once at construction; fields already present on the event
 * win, so a caller can override them per record.
 */
export class ServiceInfoProcessor implements LoggerProcessor {
  readonly name = 'service-info';
  private readonly info: NonNullable<LogEvent['service']>;

  constructor(options: ServiceInfoProcessorOptions = {}) {
    const host =
      options.hostname === false
        ? undefined
        : typeof options.hostname === 'string'
          ? options.hostname
          : hostname();
    this.info = compact({
      name: options.name,
      version: options.version,
      env: options.env ?? process.env.NODE_ENV,
      hostname: host,
      pid: options.pid === false ? undefined : process.pid,
    });
  }

  handle(event: LogEvent): LogEvent {
    return { ...event, service: { ...this.info, ...compact(event.service ?? {}) } };
  }
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
