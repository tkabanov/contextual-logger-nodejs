/**
 * `JSON.stringify` that never throws on log payloads.
 *
 * - circular references become `"[Circular]"`
 * - `bigint` becomes a decimal string
 * - `Error` keeps name, message, stack and own enumerable fields
 * - `Map` becomes an object, `Set` an array
 * - functions and symbols become their description instead of being dropped
 */
export function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();

  const replacer = function (this: unknown, _key: string, v: unknown): unknown {
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
    if (typeof v === 'symbol') return v.toString();
    if (v === null || typeof v !== 'object') return v;

    if (seen.has(v)) return '[Circular]';
    seen.add(v);

    if (v instanceof Error) {
      const cause = (v as Error & { cause?: unknown }).cause;
      return {
        ...v,
        name: v.name,
        message: v.message,
        stack: v.stack,
        ...(cause !== undefined ? { cause } : {}),
      };
    }
    if (v instanceof Map) return Object.fromEntries(v);
    if (v instanceof Set) return Array.from(v);
    return v;
  };

  try {
    return JSON.stringify(value, replacer, space);
  } catch (e) {
    // Last resort: a getter threw, or the structure is otherwise unserialisable.
    const msg = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ unserializable: true, error: msg });
  }
}
