import type { LogEvent } from './log.types';

/**
 * Processor transforms event before transports.
 */
export interface LoggerProcessor {
  readonly name: string;
  handle: (event: LogEvent) => LogEvent;
}
