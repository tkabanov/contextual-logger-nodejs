import { Logtail } from '@logtail/node';

import type { LogEvent, LoggerTransport, LogLevel } from '../../core';

type LogtailPayload = Record<string, unknown>;

export interface LogtailTransportOptions {
  /** Better Stack source token. */
  readonly sourceToken: string;
  /** Ingest endpoint, e.g. `in.logs.betterstack.com` or a full `https://` URL. */
  readonly endpoint: string;
  /** Minimum level forwarded. Defaults to forwarding everything. */
  readonly minLevel?: LogLevel;
  readonly name?: string;
}

/**
 * Logtail (Better Stack) transport.
 *
 * Entry point: `@contextual-logger/nodejs/transports/logtail`.
 * Requires the optional peer dependency `@logtail/node`.
 */
export class LogtailTransport implements LoggerTransport {
  readonly name: string;
  readonly minLevel?: LogLevel;
  private readonly client: Logtail;

  constructor(options: LogtailTransportOptions) {
    const sourceToken = options.sourceToken?.trim();
    const endpoint = options.endpoint?.trim();
    if (!sourceToken) throw new Error('LogtailTransport: sourceToken is required');
    if (!endpoint) throw new Error('LogtailTransport: endpoint is required');

    this.name = options.name ?? 'logtail';
    this.minLevel = options.minLevel;
    this.client = new Logtail(sourceToken, {
      endpoint: endpoint.startsWith('http') ? endpoint : `https://${endpoint}`,
    });
  }

  readonly logByLevel = {
    debug: (event: LogEvent) => this.send('debug', event),
    info: (event: LogEvent) => this.send('info', event),
    warn: (event: LogEvent) => this.send('warn', event),
    error: (event: LogEvent) => this.send('error', event),
    fatal: (event: LogEvent) => this.send('error', event, { level: 'fatal' }),
  };

  private buildPayload(event: LogEvent): LogtailPayload {
    return {
      message: event.msg ?? event.event,
      level: event.level,
      time: event.time,
      traceId: event.traceId,
      opId: event.opId,
      parentOpId: event.parentOpId,
      kind: event.kind,
      module: event.module,
      code: event.code,
      durMs: event.durMs,
      http: event.http,
      db: event.db,
      user: event.user,
      extra: event.extra,
      err: event.err,
      event: event.event,
    };
  }

  async log(event: LogEvent): Promise<void> {
    await this.send('info', event);
  }

  async flush(): Promise<void> {
    await this.client.flush();
  }

  async dispose(): Promise<void> {
    await this.client.flush();
  }

  private async send(
    level: 'debug' | 'info' | 'warn' | 'error',
    event: LogEvent,
    overrides: Partial<LogtailPayload> = {},
  ): Promise<void> {
    const payload = { ...this.buildPayload(event), ...overrides };
    const message = typeof payload.message === 'string' ? payload.message : (event.msg ?? event.event);
    await this.client[level](message, payload);
  }
}
