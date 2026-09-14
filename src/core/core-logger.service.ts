import { levelGte } from './level.utils';
import type { LogEvent, LogLevel } from './log.types';
import type { LoggerProcessor } from './logger-processor.interface';
import type { LoggerTransport } from './transports/transport.interface';

export type LoggerTransportErrorHandler = (transport: LoggerTransport, error: unknown) => void;

type BaseFields = Omit<LogEvent, 'level' | 'msg' | 'time'>;

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

  emit(event: LogEvent, consoleMsg?: string): void {
    let next = event;
    for (const p of this.processors) next = p.handle(next);
    void this.fanOut({ ...next, msg: next.msg ?? consoleMsg });
  }

  log(level: LogLevel, msg: string, fields: Partial<BaseFields> = {}): void {
    this.emit({ ...fields, level, msg, time: new Date().toISOString() } as LogEvent);
  }

  debug(msg: string, f?: Omit<LogEvent, 'level' | 'msg' | 'time'>) {
    this.log('debug', msg, f);
  }
  info(msg: string, f?: Omit<LogEvent, 'level' | 'msg' | 'time'>) {
    this.log('info', msg, f);
  }
  warn(msg: string, f?: Omit<LogEvent, 'level' | 'msg' | 'time'>) {
    this.log('warn', msg, f);
  }
  error(msg: string, f?: Omit<LogEvent, 'level' | 'msg' | 'time'>) {
    this.log('error', msg, f);
  }
  fatal(msg: string, f?: Omit<LogEvent, 'level' | 'msg' | 'time'>) {
    this.log('fatal', msg, f);
  }

  child(moduleName: string): {
    emit: (e: LogEvent, c?: string) => void;
    log: (lvl: LogLevel, msg: string, f?: Partial<BaseFields>) => void;
    debug: (msg: string, f?: Partial<BaseFields>) => void;
    info: (msg: string, f?: Partial<BaseFields>) => void;
    warn: (msg: string, f?: Partial<BaseFields>) => void;
    error: (msg: string, f?: Partial<BaseFields>) => void;
    fatal: (msg: string, f?: Partial<BaseFields>) => void;
  } {
    const emit = (e: LogEvent, c?: string) => this.emit({ ...e, module: e.module ?? moduleName }, c);

    const log = (lvl: LogLevel, msg: string, f: Partial<BaseFields> = {}) =>
      this.log(lvl, msg, { ...f, module: moduleName });

    const debug = (msg: string, f: Partial<BaseFields> = {}) => log('debug', msg, f);
    const info = (msg: string, f: Partial<BaseFields> = {}) => log('info', msg, f);
    const warn = (msg: string, f: Partial<BaseFields> = {}) => log('warn', msg, f);
    const error = (msg: string, f: Partial<BaseFields> = {}) => log('error', msg, f);
    const fatal = (msg: string, f: Partial<BaseFields> = {}) => log('fatal', msg, f);

    return { emit, log, debug, info, warn, error, fatal };
  }

  /**
   * Flush and dispose every transport. Call on graceful shutdown.
   * A failing transport is reported via `onTransportError` (or stderr) and does
   * not prevent the remaining transports from being flushed and disposed.
   */
  async close(): Promise<void> {
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

  private async fanOut(event: LogEvent): Promise<void> {
    for (const t of this.transports) {
      try {
        if (!t) continue;
        if (t.minLevel && !levelGte(event.level, t.minLevel)) continue;

        // Pick per-level handler if present, otherwise fallback to .log()
        const invoke: (e: LogEvent) => void | Promise<void> =
          t.logByLevel && t.logByLevel[event.level]
            ? (e: LogEvent) => t.logByLevel![event.level]!(e)
            : (e: LogEvent) => t.log(e);

        await invoke(event);
      } catch (e) {
        this.reportTransportError(t, e);
      }
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
