import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, LoggerService } from '@nestjs/common';

import { CoreLoggerService } from '../../core/core-logger.service';
import { LogEvent } from '../../core/log.types';
import { OpContextService } from './op-context.service';

@Injectable()
export class OpLoggerService implements LoggerService {
  constructor(
    private readonly ctx: OpContextService,
    private readonly core: CoreLoggerService,
  ) {}

  seed(traceId: string, options: { userId?: string } = {}): void {
    const store = this.ctx.create(traceId, options.userId);
    this.ctx.enter(store);
  }

  setUser(id?: string): void {
    this.ctx.setUser(id);
  }

  start(event: string, fields: Partial<LogEvent> = {}): void {
    const traceId = this.ensureTraceId();
    const opId = this.ctx.beginOp();
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
    const { opId, startedAt } = this.ctx.endOp();
    const context = this.ctx.get();
    const ev: LogEvent = {
      level: 'info',
      time: now(),
      traceId,
      opId,
      parentOpId: this.ctx.parentOp(),
      kind: 'finish',
      event,
      durMs: startedAt ? Date.now() - startedAt : undefined,
      module: fields.module,
      user: context?.user,
      http: fields.http,
      db: fields.db,
      extra: { orphanOp: !opId, ...(fields.extra ?? {}) },
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
    if (typeof first === 'string' && rest.length) {
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

  private ensureTraceId(): string {
    const existing = this.ctx.traceId();
    if (existing) return existing;

    const store = this.ctx.create(randomUUID());
    this.ctx.enter(store);
    return store.traceId;
  }
}

function now(): string {
  return new Date().toISOString();
}

function normalizeError(err: unknown) {
  if (err instanceof BadRequestException)
    return { name: err.name, message: err.message, response: err.getResponse() };
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  if (typeof err === 'string') return { name: 'Error', message: err };
  try {
    return { name: 'Error', message: JSON.stringify(err) };
  } catch {
    return { name: 'Error', message: 'Unknown error' };
  }
}

function getErrorMessage(err: unknown): string {
  if (err instanceof BadRequestException) return err.message;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

function isErrorLike(v: unknown): v is Error | BadRequestException {
  return v instanceof Error || v instanceof BadRequestException;
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
  return s.includes('\n') || s.includes('at ');
}
function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
