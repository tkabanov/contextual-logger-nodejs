import type { LogLevel } from './log.types';

const order: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];

export function levelGte(a: LogLevel, min: LogLevel = 'debug'): boolean {
  return order.indexOf(a) >= order.indexOf(min);
}
