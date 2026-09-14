import { levelGte } from './level.utils';
import type { LogEvent, LogLevel } from './log.types';
import type { LoggerProcessor } from './logger-processor.interface';
import type { LoggerTransport } from './transports/transport.interface';

export type LoggerTransportErrorHandler = (transport: LoggerTransport, error: unknown) => void;

/** Everything a caller may attach to a log call; `level`, `msg` and `time` are set by the logger. */
export type LogFields = Partial<Omit<LogEvent, 'level' | 'msg' | 'time'>>;

/** Logger bound to a module name; returned by `CoreLoggerService.child()`. */
export interface ChildLogger {
  emit: (event: LogEvent, consoleMsg?: string) => void;
  log: (level: LogLevel, msg: string, fields?: LogFields) => void;
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
  fatal: (msg: string, fields?: LogFields) => void;
}

/**
 * Core logging engine: processes and fan-outs events.
 *
 * Framework-agnostic: no decorators, no DI metadata. Framework adapters wrap it
 * (see `NestCoreLoggerService` in the NestJS adapter) to hook into lifecycle events.
 */
export class CoreLoggerService {
  constructor(
    private readonly transports: LoggerTransport[] = [],
    private readonly processors: LoggerProcessor[] = [],
    private readonly onTransportError?: LoggerTransportErrorHandler,
  ) {}

  /**
   * One promise chain per transport. Events reach a given transport strictly in
   * emit order, while a slow transport never delays the others.
   */
  private readonly queues = new Map<LoggerTransport, Promise<void>>();

  emit(event: LogEvent, consoleMsg?: string): void {
    let next = event;
    for (const p of this.processors) next = p.handle(next);
    this.fanOut({ ...next, msg: next.msg ?? consoleMsg });
  }

  /** Resolves once every event emitted so far has been handed to every transport. */
  async drain(): Promise<void> {
    await Promise.all(this.queues.values());
  }

  /**
   * Emit a free-form event. `traceId` and `event` are optional here: outside an
   * operation scope they default to an empty trace and the level name, so
   * infrastructure code can log without building a full `LogEvent`.
   */
  log(level: LogLevel, msg: string, fields: LogFields = {}): void {
    this.emit({
      ...fields,
      traceId: fields.traceId ?? '',
      event: fields.event ?? level,
      level,
      msg,
      time: new Date().toISOString(),
    });
  }

  debug(msg: string, fields?: LogFields): void {
    this.log('debug', msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.log('info', msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.log('warn', msg, fields);
  }
  error(msg: string, fields?: LogFields): void {
    this.log('error', msg, fields);
  }
  fatal(msg: string, fields?: LogFields): void {
    this.log('fatal', msg, fields);
  }

  child(moduleName: string): ChildLogger {
    const log = (level: LogLevel, msg: string, fields: LogFields = {}) =>
      this.log(level, msg, { ...fields, module: fields.module ?? moduleName });

    return {
      emit: (event, consoleMsg) => this.emit({ ...event, module: event.module ?? moduleName }, consoleMsg),
      log,
      debug: (msg, fields) => log('debug', msg, fields),
      info: (msg, fields) => log('info', msg, fields),
      warn: (msg, fields) => log('warn', msg, fields),
      error: (msg, fields) => log('error', msg, fields),
      fatal: (msg, fields) => log('fatal', msg, fields),
    };
  }

  /**
   * Flush and dispose every transport. Call on graceful shutdown.
   * A failing transport is reported via `onTransportError` (or stderr) and does
   * not prevent the remaining transports from being flushed and disposed.
   */
  async close(): Promise<void> {
    await this.drain();
    for (const t of this.transports) {
      if (!t) continue;
      try {
        if (t.flush) await t.flush();
      } catch (e) {
        this.reportTransportError(t, e);
      }
      try {
        if (t.dispose) await t.dispose();
      } catch (e) {
        this.reportTransportError(t, e);
      }
    }
  }

  private fanOut(event: LogEvent): void {
    for (const t of this.transports) {
      if (!t) continue;
      if (t.minLevel && !levelGte(event.level, t.minLevel)) continue;

      const previous = this.queues.get(t) ?? Promise.resolve();
      const next = previous.then(() => this.deliver(t, event));
      this.queues.set(t, next);
      // Drop the reference once the chain is idle so it cannot grow unbounded.
      void next.then(() => {
        if (this.queues.get(t) === next) this.queues.delete(t);
      });
    }
  }

  /** Never rejects: failures are reported, and the transport's queue keeps moving. */
  private async deliver(t: LoggerTransport, event: LogEvent): Promise<void> {
    try {
      // Pick per-level handler if present, otherwise fallback to .log()
      const byLevel = t.logByLevel?.[event.level];
      await (byLevel ? byLevel(event) : t.log(event));
    } catch (e) {
      this.reportTransportError(t, e);
    }
  }

  private reportTransportError(t: LoggerTransport, e: unknown): void {
    if (this.onTransportError) {
      try {
        this.onTransportError(t, e);
        return;
      } catch {
        // A throwing error handler must never take the logger down; fall through to stderr.
      }
    }
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    process.stderr.write(`Error in logger transport "${t?.name}": ${msg}\n`);
  }
}
