import type { LogEvent } from '../log.types';
import type { LoggerProcessor } from '../logger-processor.interface';

/**
 * Keys redacted by default. Matching is case-insensitive and ignores separators,
 * so `x-api-key`, `X_API_KEY` and `xApiKey` all match `xapikey`.
 */
export const DEFAULT_SENSITIVE_KEYS: readonly string[] = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'clientsecret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'xauthtoken',
  'apikey',
  'xapikey',
  'privatekey',
  'cookie',
  'setcookie',
  'sessionid',
  'ssn',
  'creditcard',
  'cardnumber',
  'cvv',
  'cvc',
  'pin',
  'otp',
];

/**
 * Patterns applied to string values (any key). Matches are replaced in place, the
 * rest of the string is kept so log lines stay readable.
 */
export const DEFAULT_SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, // Authorization: Bearer <token>
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT
];

export interface SanitizeProcessorOptions {
  /** Keys to redact. Replaces the defaults unless `extendDefaults` is true. */
  readonly keys?: readonly string[];
  /** Merge `keys` into the default list instead of replacing it. Defaults to true. */
  readonly extendDefaults?: boolean;
  /** Regexes applied to string values. Pass `[]` to disable value redaction. Defaults to Bearer tokens and JWTs. */
  readonly valuePatterns?: readonly RegExp[];
  /** Replacement text. Defaults to `[REDACTED]`. */
  readonly replacement?: string;
}

export class SanitizeProcessor implements LoggerProcessor {
  readonly name = 'sanitize';
  private readonly keys: Set<string>;
  private readonly valuePatterns: readonly RegExp[];
  private readonly replacement: string;

  constructor(options: SanitizeProcessorOptions = {}) {
    const extend = options.extendDefaults ?? true;
    const custom = options.keys ?? [];
    const keys = extend ? [...DEFAULT_SENSITIVE_KEYS, ...custom] : custom;
    this.keys = new Set(keys.map(normalizeKey));
    this.valuePatterns = options.valuePatterns ?? DEFAULT_SENSITIVE_VALUE_PATTERNS;
    this.replacement = options.replacement ?? '[REDACTED]';
  }

  handle(event: LogEvent): LogEvent {
    return this.clone(event, new WeakMap());
  }

  /**
   * Deep-clone `value`, replacing values under sensitive keys and sensitive
   * substrings inside strings. Understands the types `Object.entries` would
   * otherwise flatten into `{}`: Error, Map, Set, Date and binary buffers.
   */
  private clone<T>(value: T, seen: WeakMap<object, unknown>): T {
    if (typeof value === 'string') return this.redactString(value) as unknown as T;
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value) as T;

    if (value instanceof Date) return new Date(value.getTime()) as unknown as T;

    if (isBinary(value)) return `[${value.constructor.name} ${value.byteLength} bytes]` as unknown as T;

    if (value instanceof Error) {
      const out: Record<string, unknown> = {
        name: value.name,
        message: this.redactString(value.message),
        stack: value.stack === undefined ? undefined : this.redactString(value.stack),
      };
      seen.set(value, out);
      const cause = (value as Error & { cause?: unknown }).cause;
      if (cause !== undefined) out.cause = this.clone(cause, seen);
      for (const [key, entry] of Object.entries(value)) out[key] = this.field(key, entry, seen);
      return out as unknown as T;
    }

    if (value instanceof Map) {
      const out: Record<string, unknown> = {};
      seen.set(value, out);
      for (const [key, entry] of value) out[String(key)] = this.field(String(key), entry, seen);
      return out as unknown as T;
    }

    if (value instanceof Set || Array.isArray(value)) {
      const arr: unknown[] = [];
      seen.set(value, arr);
      for (const item of value as Iterable<unknown>) arr.push(this.clone(item, seen));
      return arr as unknown as T;
    }

    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    seen.set(source, target);
    for (const [key, entry] of Object.entries(source)) target[key] = this.field(key, entry, seen);
    return target as T;
  }

  private field(key: string, entry: unknown, seen: WeakMap<object, unknown>): unknown {
    return this.keys.has(normalizeKey(key)) ? this.replacement : this.clone(entry, seen);
  }

  private redactString(s: string): string {
    let out = s;
    for (const pattern of this.valuePatterns) {
      pattern.lastIndex = 0;
      out = out.replace(pattern, this.replacement);
    }
    return out;
  }
}

function isBinary(value: object): value is ArrayBufferView | ArrayBuffer {
  return ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}
