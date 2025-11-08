import { Logtail } from '@logtail/node';

import type { LogEvent } from '../log.types';
import type { LoggerTransport } from './transport.interface';

type LogtailPayload = Record<string, unknown>;

/**
 * Logtail transport.
 */
export class LogtailTransport implements LoggerTransport {
  readonly name = 'logtail';
  private readonly client: Logtail;

  constructor(
    private readonly sourceToken: string,
    private readonly host: string,
  ) {
    if (!sourceToken?.trim()) {
      throw new Error('LogtailTransport: token not found');
    }
    if (!host?.trim()) {
      throw new Error('LogtailTransport: host not found');
    }
    const normalizedHost = host.trim();
    this.client = new Logtail(sourceToken.trim(), {
      endpoint: normalizedHost.startsWith('http') ? normalizedHost : `https://${normalizedHost}`,
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
