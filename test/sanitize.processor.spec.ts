import type { LogEvent } from '../src';
import { SanitizeProcessor } from '../src';

describe('SanitizeProcessor', () => {
  const processor = new SanitizeProcessor();

  const event: LogEvent = {
    level: 'info',
    time: '2023-04-01T10:00:00.000Z',
    traceId: 'trace-xyz',
    event: 'user.login',
    extra: {
      nested: {
        password: 'secret123',
        token: 'abcd',
        safe: 'value',
      } as Record<string, unknown>,
      token: 'top-secret',
    } as Record<string, unknown>,
    user: {
      id: 'user-1',
    },
  };

  it('redacts sensitive keys recursively', () => {
    const result = processor.handle(event);

    const nested = result.extra?.nested as Record<string, unknown> | undefined;
    expect(nested?.password).toBe('[REDACTED]');
    expect(nested?.token).toBe('[REDACTED]');
    expect(nested?.safe).toBe('value');
    expect(result.extra?.token).toBe('[REDACTED]');
  });

  it('does not mutate original event', () => {
    const snapshot = JSON.parse(JSON.stringify(event));
    processor.handle(event);

    expect(event).toEqual(snapshot);
  });
});
