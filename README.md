# Contextual Logger for Node.js

Context-aware logging toolkit that keeps trace, user, and operation metadata flowing through your Node.js app. Use the AsyncLocalStorage-powered core in any runtime, or pull in the NestJS adapter for DI-friendly defaults. Out of the box you get automatic trace propagation, structured operation events, pluggable transports, and sanitisation without coupling logs to request lifecycle code.

## Features

- AsyncLocalStorage-based correlation (`traceId`, nested operations, user id)
- High-level `OpLoggerService` for start/finish/point/error events
- Transport pipeline with level filtering and per-level handlers
- Processor chain for sanitisation and enrichment
- Decorator-driven method tracing via `@OpLogged`
- Ready-to-use HTTP interceptor for automatic request logging
- Sensible defaults: console transport (warn+) is registered when none provided

## Installation

```bash
# Core package (framework agnostic)
npm install @contextual-logger/nodejs

# NestJS adapter (installs core + peer deps)
npm install @contextual-logger/nodejs @nestjs/common rxjs

# Optional transports (example)
npm install @logtail/node
```

The toolchain targets Node.js 18+ and TypeScript 5.5. AsyncLocalStorage support is required (Node 18 or newer).

## Quick Start (NestJS)

Drop the logger into an existing Nest app in three steps:

```ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  ConsoleTransport,
  HttpContextInterceptor,
  LoggerModule,
  OpLoggerService,
} from '@contextual-logger/nodejs';

@Module({
  imports: [
    LoggerModule.forRoot({
      transports: [new ConsoleTransport({ minLevel: 'info' })],
    }),
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpContextInterceptor,
    },
  ],
  exports: [OpLoggerService],
})
export class AppModule {}
```

Inject `OpLoggerService` anywhere and start emitting operation events:

```ts
@Injectable()
export class OrdersService {
  constructor(private readonly log: OpLoggerService) {}

  async create() {
    this.log.start('orders.create');
    try {
      // business logic
      this.log.finish('orders.create', { status: 'ok' });
    } catch (error) {
      this.log.error('orders.create', error);
      throw error;
    }
  }
}
```

For a deeper dive, keep reading the NestJS Adapter section below.

### Sample Log Output

The quick-start setup above emits structured JSON per lifecycle event. A single request produces logs similar to:

```json
{
  "time": "2025-05-18T12:00:01.234Z",
  "level": "info",
  "event": "http.request.start",
  "traceId": "8b7e6f5c-7b0f-4f5d-9d78-0c1c986b7ce6",
  "opId": "root",
  "userId": "customer-42",
  "http": { "method": "POST", "url": "/orders" }
}
{
  "time": "2025-05-18T12:00:01.310Z",
  "level": "info",
  "event": "orders.create.finish",
  "traceId": "8b7e6f5c-7b0f-4f5d-9d78-0c1c986b7ce6",
  "opId": "orders.create",
  "durMs": 76,
  "msg": "Operation finished",
  "fields": { "status": "ok" }
}
{
  "time": "2025-05-18T12:00:01.312Z",
  "level": "info",
  "event": "http.request.finish",
  "traceId": "8b7e6f5c-7b0f-4f5d-9d78-0c1c986b7ce6",
  "opId": "root",
  "durMs": 78,
  "http": { "status": 201 }
}
```

Each entry preserves the same `traceId`, making it easy to correlate operation spans, request lifecycle, and user attribution across transports.

## Runtime Requirements

- Node.js 18+ (AsyncLocalStorage stable API)
- TypeScript 5.5+
- NestJS 10+ for the provided adapter

## Core Usage (Framework Agnostic)

The core runtime lives under `@contextual-logger/nodejs/core`. You can compose the logger in any Node.js project.

### Basic Setup

```ts
import {
  CoreLoggerService,
  ConsoleTransport,
  OpContext,
  type LogEvent,
} from '@contextual-logger/nodejs/core';

const context = new OpContext();
const transports = [new ConsoleTransport({ minLevel: 'info', stream: process.stdout })];
const logger = new CoreLoggerService(transports);

function emit(event: Omit<LogEvent, 'time'>) {
  logger.emit({ ...event, time: new Date().toISOString() });
}

context.run('trace-cli', () => {
  emit({ level: 'info', event: 'job.start', traceId: context.traceId()!, msg: 'Job started' });
});
```

### Express / Fastify Middleware

```ts
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { CoreLoggerService, ConsoleTransport, OpContext } from '@contextual-logger/nodejs/core';

const ctx = new OpContext();
const core = new CoreLoggerService([new ConsoleTransport({ minLevel: 'info' })]);

export function contextualLogger(req: Request, _res: Response, next: NextFunction) {
  const traceId = req.headers['x-trace-id']?.toString() ?? randomUUID();
  const store = ctx.create(traceId, req.user?.id);
  ctx.enter(store);

  core.emit({
    level: 'info',
    time: new Date().toISOString(),
    traceId,
    event: 'http.request.start',
    msg: `${req.method} ${req.originalUrl}`,
    http: { method: req.method, url: req.originalUrl },
  });

  next();
}
```

### Background Jobs / Workers

```ts
import { CoreLoggerService, OpContext, ConsoleTransport } from '@contextual-logger/nodejs/core';

const ctx = new OpContext();
const core = new CoreLoggerService([new ConsoleTransport()]);

export async function processJob(jobId: string) {
  ctx.run(jobId, () => {
    ctx.setUser('system');
    core.emit({
      level: 'info',
      time: new Date().toISOString(),
      traceId: ctx.traceId()!,
      event: 'job.started',
      msg: `Processing ${jobId}`,
    });
  });
}
```

## NestJS Adapter

Install the adapter and register `LoggerModule.forRoot`:

```ts
import { Module } from '@nestjs/common';
import {
  ConsoleTransport,
  LoggerModule,
  OpLoggerService,
  SanitizeProcessor,
} from '@contextual-logger/nodejs';

@Module({
  imports: [
    LoggerModule.forRoot({
      transports: [new ConsoleTransport()],
      processors: [new SanitizeProcessor()],
    }),
  ],
})
export class AppModule {}

@Injectable()
class OrdersService {
  constructor(private readonly log: OpLoggerService) {}

  async createOrder() {
    this.log.start('orders.create', { module: 'OrdersService' });
    try {
      // ... business logic ...
      this.log.finish('orders.create');
    } catch (err) {
      this.log.error('orders.create', err);
      throw err;
    }
  }
}
```

### HTTP Integration

Attach the interceptor globally to automatically capture inbound requests:

```ts
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HttpContextInterceptor } from '@contextual-logger/nodejs';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpContextInterceptor,
    },
  ],
})
export class AppModule {}
```

### Method-Level Decorator

Instrument service methods with `@OpLogged`:

```ts
import { Injectable } from '@nestjs/common';
import { OpLogged } from '@contextual-logger/nodejs';

@Injectable()
class PaymentService {
  constructor(private readonly log: OpLoggerService) {}

  @OpLogged('payments.charge', { module: 'Payments' })
  async charge(userId: string, amount: number) {
    // ...
  }
}
```

The decorator will emit start/finish/error records while preserving the enclosing trace.

Behind the scenes `@OpLogged` issues:

- a `*.start` event when the method begins, capturing input metadata you provide
- a `*.finish` event with automatically calculated `durMs` on success
- a `*.error` event that normalises thrown exceptions and keeps the trace open for upstream handlers

Because the decorator relies on the AsyncLocalStorage context, ensure the service has `OpLoggerService` injected and that you have registered `LoggerModule.forRoot(...)` (and, for HTTP scenarios, the `HttpContextInterceptor`). Without those bindings the decorator cannot attach to the request scope and events will fall back to best-effort, context-free logging.

### Examples

- `examples/custom-transport.ts` – demonstrates building an in-memory transport and emitting operation logs.
- `examples/http-interceptor.ts` – simulates HTTP request handling with the built-in interceptor.

Run the examples with `ts-node`:

```bash
npx ts-node --project tsconfig.test.json examples/custom-transport.ts
npx ts-node --project tsconfig.test.json examples/http-interceptor.ts
```

## API Overview

### `LoggerModule.forRoot(options)`

| Option       | Type                | Description                                     |
| ------------ | ------------------- | ----------------------------------------------- |
| `transports` | `LoggerTransport[]` | Destination sinks (console, Logtail, custom).   |
| `processors` | `LoggerProcessor[]` | Event mutators (e.g. sanitisation, enrichment). |
| `onTransportError` | `(transport, error) => void` | Optional hook invoked when a transport throws. Use for metrics, retries, or alerting. |

When omitted, the module registers a default `ConsoleTransport` (warn+ to `stderr`). Pass an empty array to disable all transports.

Exports: `OpLoggerService`, `OpContextService`, `CoreLoggerService`. The module also aliases `Logger` and the `'LoggerService'` token to `OpLoggerService` so existing Nest code can inject the standard logger contract.

Use the framework-agnostic `OpContext` class from `@contextual-logger/nodejs/core` when wiring the logger in plain Node.js services.

### `OpLoggerService`

- `start(event, fields)` – begin an operation and push a new `opId` onto the context stack.
- `finish(event, fields)` – mark completion, automatically computing `durMs`.
- `point(level, event, fields)` – emit standalone measurement/annotation.
- `error(event, err, fields)` – normalise errors, capture stacks and orphan operations.
- Legacy helpers (`log`, `warn`, `debug`, `verbose`, `fatal`) remain for compatibility.
- `seed(traceId, { userId })` — manually create/enter a logging context when AsyncLocalStorage is unavailable (e.g. background jobs).
- `setUser(userId)` — update the bound user id for the current trace.

### `OpContext` / `OpContextService`

- `OpContext` (core) exposes `run(traceId, fn)`, `enter(store)`, `beginOp(opId?)`, `endOp()`, `setUser(id)` for AsyncLocalStorage management.
- `OpContextService` (Nest) extends `OpContext` and is registered as an injectable for request-scoped scenarios.

### `CoreLoggerService`

Low-level engine that fans out `LogEvent` objects to transports. Useful when you need structured logging outside of operation lifecycle (e.g. infrastructure code).

### Transports & Processors

- `ConsoleTransport` – configurable stream & minimum level (defaults to warn → `stderr`). Calls `flush()` and `dispose()` even though they are no-ops by default so you can extend the transport safely.
- `LogtailTransport` – forwards events to Logtail (token and host required).
- `SanitizeProcessor` – deep-clones events and redacts known sensitive keys (`password`, `token`, etc.).

Implement custom transports by fulfilling the `LoggerTransport` interface – see `examples/custom-transport.ts` for a runnable sample. For production deployments, pair custom transports with the Transport Lifecycle Guidance below to cover buffering, retries, and graceful shutdown.

### Custom Transport Skeleton

```ts
import type { LogEvent, LoggerTransport } from '@contextual-logger/nodejs';

export class HttpTransport implements LoggerTransport {
  readonly name = 'http';

  constructor(private readonly client: HttpClient) {}

  async log(event: LogEvent) {
    await this.client.post('/logs', event);
  }

  async flush() {
    await this.client.flush();
  }
}
```

Register it via:

```ts
LoggerModule.forRoot({
  transports: [new HttpTransport(client)],
  onTransportError: (transport, error) => metrics.increment(`log.errors`, { transport: transport.name }),
});
```

Wrap `log()` in retries/backoff or queueing when integrating with unstable sinks.

## Architecture & Adapters

- `src/core` contains the framework-agnostic runtime: types, transports, processors, and the `CoreLoggerService`.
- `src/adapters/nestjs` wires the core pieces into NestJS (`LoggerModule`, `HttpContextInterceptor`, `OpLoggerService`, `OpContextService` as an `OpContext` wrapper).
- Future integrations can live under `src/adapters/*`; re-export each adapter from its own `index.ts` and from the package root to keep the public surface discoverable.

## Development

Common scripts:

- `npm run build` – compile TypeScript to `dist/`.
- `npm run test` – run the Jest suite.
- `npm run lint` / `npm run format` – quality gates.

### Transport Lifecycle Guidance

Transports may buffer or batch events. `CoreLoggerService` will invoke two lifecycle hooks on shutdown:

- `flush()` should resolve once all queued events are sent (e.g. drain buffers or finish retries).
- `dispose()` should release external resources (close connections, stop timers, tear down workers).

`ConsoleTransport` provides empty implementations; override them when building heavy transports.

Use the `onTransportError` hook (or implement your own inside a transport) to emit metrics, trigger retries, or surface alerts when a sink fails. A simple pattern is to enqueue the event for later retry inside the hook and log a warning via another transport.

### Resilience & Backoff Recommendations

- Wrap network transports with retry logic (e.g. exponential backoff, circuit breakers) to avoid hammering downstream vendors.
- Consider buffering events (in memory, Redis, or queue) when a transport is temporarily unavailable.
- Use `LoggerTransport.flush()` for graceful shutdown: drain buffers and persist unsent batches.
- Expose transport health via metrics (`onTransportError` hook + counter) so operators know when sinks fail.
- Validate these patterns against the runnable examples in `examples/custom-transport.ts` to ensure behaviour matches expectations before rolling to production.

### Manual Context Seeding

`OpLoggerService` will lazily create a trace if logging occurs outside an AsyncLocalStorage scope. For explicit control (cron jobs, message consumers), call:

```ts
logger.seed(traceId, { userId: 'user-42' });
logger.start('job.process');
try {
  // ...
  logger.finish('job.process');
} catch (err) {
  logger.error('job.process', err);
}
```

Alternatively, use `OpContextService.run(traceId, () => { ... })` to execute a function inside a managed scope.

### Release Checklist (npm)

- Releases are automated via `semantic-release` (see `.releaserc.json` and `.github/workflows/release.yml`).
- Ensure `npm run lint`, `npm test`, and `npm run build` pass locally and in CI before merging to `main`.
- Run `npm pack` locally to verify only `dist`, `.d.ts`, docs, and license are included.
- If publishing manually, update `CHANGELOG.md` and verify package metadata; `semantic-release` handles this when run in CI.
- Link the GitHub repository as a [trusted publisher](https://docs.npmjs.com/trusted-publishers) in npm package settings.

### CI & Semantic Release

- Adopt Conventional Commits (`feat:`, `fix:`, `chore:`) so `semantic-release` can infer version bumps.
- Configure a CI job that runs on `main` after tests succeed:

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  - uses: actions/setup-node@v4
    with:
      node-version: 20
      registry-url: https://registry.npmjs.org
  - run: npm ci
  - run: npm test
  - run: npm run build
  - run: npx semantic-release
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      NPM_CONFIG_PROVENANCE: true
```

- Ensure the workflow declares `permissions: { id-token: write }` so npm can issue a trusted publishing token.
- Use `npm run release -- --dry-run` locally to verify configuration before enabling CI publishes.

## Security & Privacy Notes

- Sanitisation is opt-in: include `SanitizeProcessor` to redact secrets.
- Error handling in transports is isolated; failures are reported to `stderr` but do not break the request flow.
- Custom transports should handle retries, backoff, and network failures gracefully.

## License

MIT © 2025
