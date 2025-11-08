import type { LogEvent } from '../log.types';
import type { LoggerProcessor } from '../logger-processor.interface';

const SENSITIVE_KEYS = new Set([
  'password',
  'authorization',
  'token',
  'secret',
  'cookie',
  'xapikey',
  'apikey',
  'accesstoken',
  'refreshtoken',
]);

export class SanitizeProcessor implements LoggerProcessor {
  readonly name = 'sanitize';

  handle(event: LogEvent): LogEvent {
    return cloneAndRedact(event);
  }
}

function cloneAndRedact<T>(value: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
  if (value === null || typeof value !== 'object') return value;

  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value) as T;
    const arr: unknown[] = [];
    seen.set(value, arr);
    for (const item of value) {
      arr.push(cloneAndRedact(item, seen));
    }
    return arr as T;
  }

  const source = value as Record<string, unknown>;
  if (seen.has(source)) return seen.get(source) as T;

  const target: Record<string, unknown> = {};
  seen.set(source, target);

  for (const [key, entry] of Object.entries(source)) {
    if (shouldRedact(key)) {
      target[key] = '[REDACTED]';
      continue;
    }
    target[key] = cloneAndRedact(entry, seen);
  }

  return target as T;
}

function shouldRedact(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEYS.has(normalized);
}
