export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Fields a caller may attach to an operation record (`start`/`finish`/`point`/`error`).
 * Everything else on `LogEvent` (level, time, trace and op ids, kind, user) is
 * owned by the logger and derived from the current context.
 */
export type OpFields = Partial<
  Pick<LogEvent, 'module' | 'code' | 'msg' | 'durMs' | 'http' | 'db' | 'err' | 'extra'>
>;

export interface LogEvent {
  level: LogLevel;
  time: string;
  traceId: string;
  opId?: string;
  parentOpId?: string;
  kind?: 'start' | 'finish' | 'point' | 'error';
  event: string;
  msg?: string;
  module?: string;
  code?: string;
  durMs?: number;
  http?: { method?: string; url?: string; status?: number };
  db?: { model?: string; op?: string; rows?: number };
  user?: { id?: string };
  err?: {
    name?: string;
    message?: string;
    stack?: string;
    cause?: string;
    /** HTTP status for framework HTTP exceptions. */
    status?: number;
    /** Framework-specific error body (e.g. NestJS `HttpException.getResponse()`). */
    response?: unknown;
  };
  extra?: Record<string, unknown>;
}
