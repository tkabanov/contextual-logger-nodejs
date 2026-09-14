import { randomUUID } from 'node:crypto';

import { HttpException, Injectable, type LoggerService } from '@nestjs/common';

import { CoreLoggerService } from '../../core/core-logger.service';
import { LogEvent } from '../../core/log.types';
import { OpContextService } from './op-context.service';

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
    this.ctx.enter(store);
  }

  setUser(id?: string): void {
    this.ctx.setUser(id);
  }

  start(event: string, fields: Partial<LogEvent> = {}): void {
    const traceId = this.ensureTraceId();
    const opId = this.ctx.beginOp(undefined, event);
    const context = this.ctx.get();
    const ev: LogEvent = {
      level: 'info',
      time: now(),
      traceId,
      opId,
      parentOpId: this.ctx.parentOp(),
      kind: 'start',
      event,
      module: fields.module,
      user: context?.user,
      http: fields.http,
      db: fields.db,
      extra: fields.extra,
      msg: fields.msg,
    };
    this.core.emit(ev, ev.msg);
  }

  finish(event: string, fields: Partial<LogEvent> = {}): void {
    const traceId = this.ensureTraceId();
    // Read the parent while the finishing op is still on the stack: after endOp()
    // parentOp() would point at the grandparent.
    const parentOpId = this.ctx.parentOp();
    const ended = this.ctx.endOp();
    const context = this.ctx.get();

    // Ops close LIFO. If the caller finishes an event other than the innermost
    // open one, flag it so unbalanced start/finish pairs are visible in the logs.
    const mismatch = ended.event !== undefined && ended.event !== event ? { opMismatch: ended.event } : {};

    const ev: LogEvent = {
      level: 'info',
      time: now(),
      traceId,
      opId: ended.opId,
      parentOpId,
      kind: 'finish',
      event,
      durMs: ended.startedAt ? Date.now() - ended.startedAt : undefined,
      module: fields.module,
      user: context?.user,
      http: fields.http,
      db: fields.db,
      extra: { orphanOp: !ended.opId, ...mismatch, ...(fields.extra ?? {}) },
      msg: fields.msg,
    };
    this.core.emit(ev, ev.msg);
  }

  point(level: LogEvent['level'], event: string, fields: Partial<LogEvent> = {}): void {
    const traceId = this.ensureTraceId();
    const current = this.ctx.currentOp();
    const context = this.ctx.get();
    const ev: LogEvent = {
      level,
      time: now(),
      traceId,
      opId: current,
      parentOpId: this.ctx.parentOp(),
      kind: 'point',
      event,
      module: fields.module,
      code: fields.code,
      user: context?.user,
      http: fields.http,
      db: fields.db,
      err: fields.err,
      extra: { orphanOp: !current, ...(fields.extra ?? {}) },
      msg: fields.msg,
    };
    this.core.emit(ev, ev.msg);
  }

  error(event: string, err: unknown, fields?: Partial<LogEvent>): void;
  error(message: unknown, ...optionalParams: unknown[]): void;

  error(first: unknown, ...rest: unknown[]): void {
    if (isStructuredErrorCall(first, rest)) {
      const event = first;
      const [err, fieldsOrUndefined] = rest;
      const fields = (fieldsOrUndefined as Partial<LogEvent> | undefined) ?? {};
      const traceId = this.ensureTraceId();
      const current = this.ctx.currentOp();
      const normalized = normalizeError(err);
      const context = this.ctx.get();

      const ev: LogEvent = {
        level: 'error',
        time: now(),
        traceId,
        opId: current,
        parentOpId: this.ctx.parentOp(),
        kind: 'error',
        event,
        module: fields.module,
        code: fields.code,
        user: context?.user,
        http: fields.http,
        db: fields.db,
        err: normalized,
        extra: { orphanOp: !current, ...(fields.extra ?? {}) },
        msg: fields.msg ?? getErrorMessage(err),
      };
      this.core.emit(ev, ev.msg);
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
    level: LogEvent['level'],
    msg: string,
    module?: string,
    extra?: Record<string, unknown>,
  ): void {
    const current = this.ctx.currentOp();
    const traceId = this.ensureTraceId();
    const context = this.ctx.get();
    const ev: LogEvent = {
      level,
      time: now(),
      traceId,
      opId: current,
      parentOpId: this.ctx.parentOp(),
      kind: 'point',
      event: level,
      module,
      msg,
      extra: { orphanOp: !current, ...(extra ?? {}) },
      user: context?.user,
    };
    this.core.emit(ev, ev.msg);
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
