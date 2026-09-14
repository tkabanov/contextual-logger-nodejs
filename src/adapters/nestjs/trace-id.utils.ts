import type { IncomingHttpHeaders } from 'node:http';

export const TRACE_ID_HEADER = 'x-trace-id';

/** Longest inbound trace id we accept; anything longer is replaced by a generated id. */
export const TRACE_ID_MAX_LENGTH = 128;

const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

/**
 * Inbound trace ids are attacker-controlled: they end up in log lines and are echoed
 * in the response header. Accept only a bounded, header-safe alphabet (UUIDs, W3C
 * trace ids and common vendor formats all pass).
 */
export function isValidTraceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= TRACE_ID_MAX_LENGTH &&
    TRACE_ID_PATTERN.test(value)
  );
}

/** Resolve an inbound trace id from `x-trace-id` or a W3C `traceparent` header. */
export function extractTraceId(headers: IncomingHttpHeaders): string | undefined {
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) map[k.toLowerCase()] = v[0] ?? '';
    else if (typeof v === 'string') map[k.toLowerCase()] = v;
  }
  const explicit = map[TRACE_ID_HEADER]?.trim();
  if (isValidTraceId(explicit)) return explicit;
  return fromTraceparent(map['traceparent']);
}

function fromTraceparent(tp?: string): string | undefined {
  if (!tp) return undefined;
  const parts = tp.trim().split('-'); // version-traceId-parentId-flags
  const traceId = parts[1];
  return traceId && /^[0-9a-f]{32}$/i.test(traceId) ? traceId : undefined;
}
