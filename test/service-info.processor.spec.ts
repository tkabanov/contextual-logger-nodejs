import { hostname } from 'node:os';

import type { LogEvent } from '../src';
import { ServiceInfoProcessor } from '../src';

const event: LogEvent = { level: 'info', time: 't', traceId: 'tr', event: 'e' };

describe('ServiceInfoProcessor', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('stamps name, version, env, hostname and pid', () => {
    process.env.NODE_ENV = 'test-env';
    const processor = new ServiceInfoProcessor({ name: 'orders-api', version: '1.2.3' });

    expect(processor.handle(event).service).toEqual({
      name: 'orders-api',
      version: '1.2.3',
      env: 'test-env',
      hostname: hostname(),
      pid: process.pid,
    });
  });

  it('honours explicit env, fixed hostname and disabled fields', () => {
    const processor = new ServiceInfoProcessor({ env: 'prod', hostname: 'pod-7', pid: false });

    expect(processor.handle(event).service).toEqual({ env: 'prod', hostname: 'pod-7' });
    expect(new ServiceInfoProcessor({ hostname: false, pid: false, env: 'x' }).handle(event).service).toEqual(
      {
        env: 'x',
      },
    );
  });

  it('lets per-event values win over the static ones', () => {
    const processor = new ServiceInfoProcessor({
      name: 'api',
      version: '1',
      env: 'prod',
      hostname: 'h',
      pid: false,
    });
    const result = processor.handle({ ...event, service: { version: '2-canary' } });

    expect(result.service).toEqual({ name: 'api', version: '2-canary', env: 'prod', hostname: 'h' });
    expect(event.service).toBeUndefined(); // input untouched
  });
});
