import { extractTraceId, isValidTraceId, TRACE_ID_MAX_LENGTH } from '../src';

describe('trace-id utils', () => {
  it('accepts uuid, w3c and vendor-style ids', () => {
    expect(isValidTraceId('8b7e6f5c-7b0f-4f5d-9d78-0c1c986b7ce6')).toBe(true);
    expect(isValidTraceId('12345678901234567890123456789012')).toBe(true);
    expect(isValidTraceId('svc:req.42_x')).toBe(true);
    expect(isValidTraceId('a'.repeat(TRACE_ID_MAX_LENGTH))).toBe(true);
  });

  it('rejects empty, over-long and header-unsafe values', () => {
    expect(isValidTraceId('')).toBe(false);
    expect(isValidTraceId('a'.repeat(TRACE_ID_MAX_LENGTH + 1))).toBe(false);
    expect(isValidTraceId('with space')).toBe(false);
    expect(isValidTraceId('crlf\r\ninjection')).toBe(false);
    expect(isValidTraceId('<script>')).toBe(false);
    expect(isValidTraceId(42)).toBe(false);
  });

  it('prefers a valid x-trace-id, then traceparent, then nothing', () => {
    expect(extractTraceId({ 'x-trace-id': ' trace-1 ' })).toBe('trace-1');
    expect(extractTraceId({ 'x-trace-id': ['first', 'second'] })).toBe('first');
    expect(
      extractTraceId({
        'x-trace-id': 'bad id',
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      }),
    ).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(extractTraceId({ traceparent: '00-nothex-b7ad6b7169203331-01' })).toBeUndefined();
    expect(extractTraceId({})).toBeUndefined();
  });
});
