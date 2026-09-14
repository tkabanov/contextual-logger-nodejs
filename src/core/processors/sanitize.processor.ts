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

/**
 * Deep-clone `value`, replacing values under sensitive keys with `[REDACTED]`.
 *
 * Besides plain objects and arrays it understands the types that `Object.entries`
 * would otherwise flatten into `{}` or garbage: Error (non-enumerable fields),
 * Map, Set, Date and binary buffers.
 */
function cloneAndRedact<T>(value: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value) as T;

  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;

  if (isBinary(value)) return `[${value.constructor.name} ${value.byteLength} bytes]` as unknown as T;

  if (value instanceof Error) {
    const out: Record<string, unknown> = { name: value.name, message: value.message, stack: value.stack };
    seen.set(value, out);
    const cause = (value as Error & { cause?: unknown }).cause;
    if (cause !== undefined) out.cause = cloneAndRedact(cause, seen);
    // Custom enumerable fields on error subclasses (e.g. `code`, `response`).
    for (const [key, entry] of Object.entries(value)) {
      out[key] = shouldRedact(key) ? '[REDACTED]' : cloneAndRedact(entry, seen);
    }
    return out as unknown as T;
  }

  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const [key, entry] of value) {
      const k = String(key);
      out[k] = shouldRedact(k) ? '[REDACTED]' : cloneAndRedact(entry, seen);
    }
    return out as unknown as T;
  }

  if (value instanceof Set) {
    const arr: unknown[] = [];
    seen.set(value, arr);
    for (const item of value) arr.push(cloneAndRedact(item, seen));
    return arr as unknown as T;
  }

  if (Array.isArray(value)) {
    const arr: unknown[] = [];
    seen.set(value, arr);
    for (const item of value) arr.push(cloneAndRedact(item, seen));
    return arr as T;
  }

  const source = value as Record<string, unknown>;
  const target: Record<string, unknown> = {};
  seen.set(source, target);
  for (const [key, entry] of Object.entries(source)) {
    target[key] = shouldRedact(key) ? '[REDACTED]' : cloneAndRedact(entry, seen);
  }
  return target as T;
}

function isBinary(value: object): value is ArrayBufferView | ArrayBuffer {
  return ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
}

function shouldRedact(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEYS.has(normalized);
}
