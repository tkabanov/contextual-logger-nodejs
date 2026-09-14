import { randomUUID } from 'node:crypto';

import { HttpException, Injectable, type LoggerService } from '@nestjs/common';

import { CoreLoggerService } from '../../core/core-logger.service';
import type { LogEvent, LogLevel, OpFields } from '../../core/log.types';
import { OpContextService } from './op-context.service';

type OpMeta = { opId?: string; parentOpId?: string; extra?: Record<string, unknown> };

@Injectable()
export class OpLoggerService implements LoggerService {
  constructor(
    private readonly ctx: OpContextService,
    private readonly core: CoreLoggerService,
  ) {}

  /**
   * Run `fn` inside a fresh trace scope (cron jobs, queue consumers, CLI commands).
   * The scope ends with `fn`, so nothing leaks into other tasks.
   */
  run<T>(traceId: string, fn: () => T, options: { userId?: string } = {}): T {
    return this.ctx.run(traceId, fn, options);
  }

  /**
   * Bind a trace to the current async execution without a callback.
   *
   * @deprecated Use `run(traceId, fn, { userId })`. `seed` relies on
   * `AsyncLocalStorage.enterWith`, which never exits: called from a shared
   * context such as application bootstrap it leaks the store into every later
   * async task, including unrelated requests. Will be removed in the next major.
   */
  seed(traceId: string, options: { userId?: string } = {}): void {
    const store = this.ctx.create(traceId, options.userId);
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- seed() is the deprecated wrapper itself
    this.ctx.enter(store);
  }

  setUser(id?: string): void {
    this.ctx.setUser(id);
  }

  start(event: string, fields: OpFields = {}): void {
    const opId = this.ctx.beginOp(undefined, event);
    this.core.emit(this.build('info', 'start', event, fields, { opId, parentOpId: this.ctx.parentOp() }));
  }

  finish(event: string, fields: OpFields = {}): void {
    // Read the parent while the finishing op is still on the stack: after endOp()
    // parentOp() would point at the grandparent.
    const parentOpId = this.ctx.parentOp();
    const ended = this.ctx.endOp();

    // Ops close LIFO. If the caller finishes an event other than the innermost
    // open one, flag it so unbalanced start/finish pairs are visible in the logs.
    const mismatch = ended.event !== undefined && ended.event !== event ? { opMismatch: ended.event } : {};
    const durMs = fields.durMs ?? (ended.startedAt ? Date.now() - ended.startedAt : undefined);

    this.core.emit(
      this.build(
        'info',
        'finish',
        event,
        { ...fields, durMs },
        { opId: ended.opId, parentOpId, extra: { orphanOp: !ended.opId, ...mismatch } },
      ),
    );
  }

  point(level: LogLevel, event: string, fields: OpFields = {}): void {
    this.core.emit(this.build(level, 'point', event, fields, this.currentOpMeta()));
  }

  error(event: string, err: unknown, fields?: OpFields): void;
  error(message: unknown, ...optionalParams: unknown[]): void;

  error(first: unknown, ...rest: unknown[]): void {
    if (isStructuredErrorCall(first, rest)) {
      const [err, fieldsOrUndefined] = rest;
      const fields = (fieldsOrUndefined as OpFields | undefined) ?? {};
      this.core.emit(
        this.build(
          'error',
          'error',
          first,
          { ...fields, err: fields.err ?? normalizeError(err), msg: fields.msg ?? getErrorMessage(err) },
          this.currentOpMeta(),
        ),
      );
      return;
    }

    const message = first;
    const optionalParams = rest;

    if (isErrorLike(message)) {
      const { module, extra } = parseLegacyArgs(undefined, optionalParams);
      this.emitLegacyPoint('error', getErrorMessage(message), module, {
        ...extra,
        err: normalizeError(message),
      });
      return;
    }

    const { module, extra, stack, msg } = parseLegacyArgs(message, optionalParams);
    const err = stack ? Object.assign(new Error(String(msg)), { stack }) : new Error(String(msg));
    this.emitLegacyPoint('error', getErrorMessage(err), module, { ...extra, err: normalizeError(err) });
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    const { msg, module, extra } = parseLegacyArgs(message, optionalParams);
    this.emitLegacyPoint('info', msg, module, extra);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    const { msg, module, extra } = parseLegacyArgs(message, optionalParams);
    this.emitLegacyPoint('warn', msg, module, extra);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    const { msg, module, extra } = parseLegacyArgs(message, optionalParams);
    this.emitLegacyPoint('debug', msg, module, extra);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    const { msg, module, extra } = parseLegacyArgs(message, optionalParams);
    this.emitLegacyPoint('debug', msg, module, extra);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    const { msg, module, extra } = parseLegacyArgs(message, optionalParams);
    this.emitLegacyPoint('fatal', msg, module, extra);
  }

  private emitLegacyPoint(
    level: LogLevel,
    msg: string,
    module?: string,
    extra?: Record<string, unknown>,
  ): void {
    this.core.emit(this.build(level, 'point', level, { module, msg, extra }, this.currentOpMeta()));
  }

  /** Op ids for records that annotate the currently open operation (point, error, legacy). */
  private currentOpMeta(): OpMeta {
    const opId = this.ctx.currentOp();
    return { opId, parentOpId: this.ctx.parentOp(), extra: { orphanOp: !opId } };
  }

  /**
   * Single place that turns caller fields plus context into a `LogEvent`, so every
   * record kind carries the same set of fields.
   */
  private build(
    level: LogLevel,
    kind: LogEvent['kind'],
    event: string,
    fields: OpFields,
    meta: OpMeta,
  ): LogEvent {
    const extra = meta.extra || fields.extra ? { ...(meta.extra ?? {}), ...(fields.extra ?? {}) } : undefined;
    return {
      level,
      time: now(),
      traceId: this.ensureTraceId(),
      opId: meta.opId,
      parentOpId: meta.parentOpId,
      kind,
      event,
      module: fields.module,
      code: fields.code,
      msg: fields.msg,
      durMs: fields.durMs,
      http: fields.http,
      db: fields.db,
      err: fields.err,
      user: this.ctx.get()?.user,
      extra,
    };
  }

  /**
   * Trace id for the current event. Outside an ALS scope a one-off id is generated
   * per event and deliberately NOT stored: `enterWith` from an unscoped call site
   * (e.g. bootstrap logging) would leak that store into every later async task,
   * including unrelated HTTP requests. Use `seed()` or `OpContextService.run` to
   * bind a trace explicitly.
   */
  private ensureTraceId(): string {
    return this.ctx.traceId() ?? randomUUID();
  }
}

function now(): string {
  return new Date().toISOString();
}

function normalizeError(err: unknown): NonNullable<LogEvent['err']> {
  // Any Nest HTTP exception (400, 403, 404, ...), not only BadRequestException.
  if (err instanceof HttpException) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      status: err.getStatus(),
      response: err.getResponse(),
    };
  }
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  if (typeof err === 'string') return { name: 'Error', message: err };
  try {
    return { name: 'Error', message: JSON.stringify(err) };
  } catch {
    return { name: 'Error', message: 'Unknown error' };
  }
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

function isErrorLike(v: unknown): v is Error {
  return v instanceof Error;
}

/**
 * Distinguish the structured overload `error(event, err, fields?)` from Nest's
 * legacy `error(message, stack?, context?)` / `error(message, ...params)`.
 *
 * A call is structured when the first argument is a string event name, the second
 * argument exists and is not a string (Nest passes stack and context as strings),
 * and the optional third argument is a plain fields object.
 */
function isStructuredErrorCall(first: unknown, rest: unknown[]): first is string {
  if (typeof first !== 'string' || rest.length === 0 || rest.length > 2) return false;
  const [err, fields] = rest;
  if (typeof err === 'string') return false;
  if (rest.length === 2 && !isPlainObject(fields)) return false;
  return true;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

function parseLegacyArgs(
  message: unknown,
  optionalParams: unknown[],
): { msg: string; module?: string; extra?: Record<string, unknown>; stack?: string } {
  const msg = typeof message === 'string' ? message : message == null ? '' : safeStringify(message);

  let stack: string | undefined;
  let context: string | undefined;
  const rest: unknown[] = [];

  for (const p of optionalParams) {
    if (typeof p === 'string' && !stack && looksLikeStack(p)) {
      stack = p;
      continue;
    }
    if (typeof p === 'string' && !context) {
      context = p;
      continue;
    }
    rest.push(p);
  }

  const extra = rest.length ? { args: rest } : undefined;
  return { msg, module: context, extra, stack };
}

function looksLikeStack(s: string): boolean {
  return /\n\s*at\s/.test(s) || /^\w*Error\b.*\n/.test(s);
}
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
