import type { IncomingHttpHeaders } from 'node:http';

export const TRACE_ID_HEADER = 'x-trace-id';

/** Resolve an inbound trace id from `x-trace-id` or a W3C `traceparent` header. */
export function extractTraceId(headers: IncomingHttpHeaders): string | undefined {
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) map[k.toLowerCase()] = v[0] ?? '';
    else if (typeof v === 'string') map[k.toLowerCase()] = v;
  }
  return map[TRACE_ID_HEADER] || fromTraceparent(map['traceparent']);
}

function fromTraceparent(tp?: string): string | undefined {
  if (!tp) return undefined;
  const parts = tp.split('-'); // version-traceId-parentId-flags
  return parts[1]?.length === 32 ? parts[1] : undefined;
}
