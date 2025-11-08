import type { LogEvent, LogLevel } from '../log.types';

/**
 * Transport sink. Supports per-level routing and minLevel filter.
 */
export interface LoggerTransport {
  readonly name: string;
  readonly minLevel?: LogLevel;
  readonly logByLevel?: Partial<Record<LogLevel, (event: LogEvent) => void | Promise<void>>>;
  log: (event: LogEvent) => void | Promise<void>;
  flush?: () => Promise<void>;
  dispose?: () => Promise<void>;
}
