export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

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
  err?: { name?: string; message?: string; stack?: string; cause?: string };
  extra?: Record<string, unknown>;
}
