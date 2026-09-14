import * as Sentry from '@sentry/node';

import type { LogEvent, LoggerTransport, LogLevel } from '../../core';

type SentrySeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

/**
 * Minimal surface of the Sentry SDK used by the transport. Matches `@sentry/node`
 * (the default), and lets tests or other SDK flavours (`@sentry/bun`, a Hub) plug in.
 */
export interface SentryClientLike {
  captureException: (exception: unknown, context?: SentryCaptureContext) => unknown;
  captureMessage: (message: string, context?: SentryCaptureContext) => unknown;
  flush?: (timeout?: number) => Promise<boolean>;
}

export interface SentryCaptureContext {
  level?: SentrySeverity;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id?: string };
  fingerprint?: string[];
}

export interface SentryTransportOptions {
  /** SDK to use. Defaults to `@sentry/node`, which must already be initialised via `Sentry.init`. */
  readonly client?: SentryClientLike;
  /** Minimum level forwarded to Sentry. Defaults to `error`. */
  readonly minLevel?: LogLevel;
  /** Send events without an error payload as Sentry messages. Defaults to `true`. */
  readonly captureMessages?: boolean;
  /** Timeout for `flush()` in milliseconds. Defaults to 2000. */
  readonly flushTimeoutMs?: number;
  readonly name?: string;
}

const SEVERITY: Record<LogLevel, SentrySeverity> = {
  debug: 'debug',
  info: 'info',
  warn: 'warning',
  error: 'error',
  fatal: 'fatal',
};

/**
 * Sentry transport.
 *
 * Entry point: `@contextual-logger/nodejs/transports/sentry`.
 * Requires the optional peer dependency `@sentry/node`. The transport never calls
 * `Sentry.init`; initialise the SDK in your application and pass nothing, or pass
 * a custom `client`.
 *
 * Events carrying `err` (or `kind: 'error'`) become Sentry exceptions, everything
 * else becomes a message. `traceId`, `opId`, `module`, `event` and `code` are
 * attached as tags so issues can be searched by trace.
 */
export class SentryTransport implements LoggerTransport {
  readonly name: string;
  readonly minLevel: LogLevel;
  private readonly client: SentryClientLike;
  private readonly captureMessages: boolean;
  private readonly flushTimeoutMs: number;

  constructor(options: SentryTransportOptions = {}) {
    this.client = options.client ?? (Sentry as SentryClientLike);
    this.minLevel = options.minLevel ?? 'error';
    this.captureMessages = options.captureMessages ?? true;
    this.flushTimeoutMs = options.flushTimeoutMs ?? 2000;
    this.name = options.name ?? 'sentry';
  }

  log(event: LogEvent): void {
    const context = buildContext(event);

    if (event.err || event.kind === 'error') {
      this.client.captureException(toError(event), context);
      return;
    }
    if (this.captureMessages) {
      this.client.captureMessage(event.msg ?? event.event, context);
    }
  }

  async flush(): Promise<void> {
    await this.client.flush?.(this.flushTimeoutMs);
  }

  async dispose(): Promise<void> {
    await this.flush();
  }
}

function buildContext(event: LogEvent): SentryCaptureContext {
  const tags: Record<string, string> = { traceId: event.traceId, event: event.event };
  if (event.opId) tags.opId = event.opId;
  if (event.parentOpId) tags.parentOpId = event.parentOpId;
  if (event.module) tags.module = event.module;
  if (event.code) tags.code = event.code;
  if (event.kind) tags.kind = event.kind;

  const extra: Record<string, unknown> = { time: event.time };
  if (event.msg) extra.msg = event.msg;
  if (event.durMs !== undefined) extra.durMs = event.durMs;
  if (event.http) extra.http = event.http;
  if (event.db) extra.db = event.db;
  if (event.extra) Object.assign(extra, event.extra);

  return {
    level: SEVERITY[event.level],
    tags,
    extra,
    user: event.user?.id ? { id: event.user.id } : undefined,
  };
}

/** Rebuild an Error from the serialised `err` so Sentry groups by stack, not by message text. */
function toError(event: LogEvent): Error {
  const err = event.err ?? {};
  const error = new Error(err.message ?? event.msg ?? event.event);
  if (err.name) error.name = err.name;
  if (err.stack) error.stack = err.stack;
  if (err.cause) (error as Error & { cause?: unknown }).cause = err.cause;
  return error;
}
