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
# Core only (zero runtime dependencies)
npm install @contextual-logger/nodejs

# NestJS adapter
npm install @contextual-logger/nodejs @nestjs/common rxjs

# Optional transports: install only the SDKs you use
npm install @logtail/node
npm install @sentry/node
```

All peer dependencies are optional. Each entry point below loads only what it needs, so a plain Node.js service using `@contextual-logger/nodejs/core` never touches NestJS, Logtail or Sentry.

### Entry points

| Import path                                    | Contents                                                                                                           | Peer dependencies        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `@contextual-logger/nodejs/core`               | Framework-agnostic runtime: `OpContext`, `CoreLoggerService`, `ConsoleTransport`, `SanitizeProcessor`, types.      | none                     |
| `@contextual-logger/nodejs/nestjs`             | NestJS adapter: `LoggerModule`, `HttpContextMiddleware`, `HttpContextInterceptor`, `OpLoggerService`, `@OpLogged`. | `@nestjs/common`, `rxjs` |
| `@contextual-logger/nodejs/transports/logtail` | `LogtailTransport` (Better Stack / Logtail).                                                                       | `@logtail/node`          |
| `@contextual-logger/nodejs/transports/sentry`  | `SentryTransport`.                                                                                                 | `@sentry/node`           |
| `@contextual-logger/nodejs`                    | Convenience root: core + NestJS adapter. Transports are never re-exported from here.                               | `@nestjs/common`, `rxjs` |

Transports are deliberately kept out of the root and core entry points: adding a new sink to your app is an explicit import plus its SDK, and nothing else in the package changes.

The toolchain targets Node.js 20+ and TypeScript 5.5. CI runs on Node 20, 22 and 24.

## Quick Start (NestJS)

Drop the logger into an existing Nest app in three steps:

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  ConsoleTransport,
  HttpContextInterceptor,
  HttpContextMiddleware,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Establishes the trace context before guards, pipes and interceptors run.
    consumer.apply(HttpContextMiddleware).forRoutes('*');
  }
}
```

`HttpContextMiddleware` creates the per-request AsyncLocalStorage store as early as Nest allows, so guards and other middleware already see the trace id. `HttpContextInterceptor` reuses that store and emits the `http.request` start/finish/error events. The interceptor also works on its own (it creates a scoped store if none exists), but then anything running before it, such as guards, logs without a trace.

Inject `OpLoggerService` anywhere and start emitting operation events:

```ts
@Injectable()
export class OrdersService {
  constructor(private readonly log: OpLoggerService) {}

  async create() {
    this.log.start('orders.create');
    try {
      // business logic
      this.log.finish('orders.create', { extra: { status: 'ok' } });
    } catch (error) {
      this.log.error('orders.create', error);
      throw error;
    }
  }
}
```

For a deeper dive, keep reading the NestJS Adapter section below.

### Sample Log Output

Every event is one JSON line. The output below was produced by the built package for a `POST /orders` request handled by `HttpContextMiddleware` + `HttpContextInterceptor`, with a service that calls `start`, `point` and `finish` for `orders.create`:

```json
{"level":"info","time":"2026-09-14T16:47:11.785Z","traceId":"8b7e6f5c-7b0f-4f5d-9d78-0c1c986b7ce6","opId":"1ffc0cc8-d5de-4084-88c5-940ca98aee09","kind":"start","event":"http.request","module":"Http","user":{"id":"customer-42"},"http":{"method":"POST","url":"/orders"},"msg":"POST /orders"}
{"level":"info","time":"2026-09-14T16:47:11.786Z","traceId":"8b7e6f5c-7b0f-4f5d-9d78-0c1c986b7ce6","opId":"9d2c9a32-2397-4c53-9591-6a98f8e862f4","parentOpId":"1ffc0cc8-d5de-4084-88c5-940ca98aee09","kind":"start","event":"orders.create","module":"OrdersService","user":{"id":"customer-42"}}
{"level":"info","time":"2026-09-14T16:47:11.827Z","traceId":"8b7e6f5c-7b0f-4f5d-9d78-0c1c986b7ce6","opId":"9d2c9a32-2397-4c53-9591-6a98f8e862f4","parentOpId":"1ffc0cc8-d5de-4084-88c5-940ca98aee09","kind":"point","event":"orders.create","module":"OrdersService","user":{"id":"customer-42"},"extra":{"orphanOp":false,"amount":1290},"msg":"Payment authorised"}
{"level":"info","time":"2026-09-14T16:47:11.827Z","traceId":"8b7e6f5c-7b0f-4f5d-9d78-0c1c986b7ce6","opId":"9d2c9a32-2397-4c53-9591-6a98f8e862f4","parentOpId":"1ffc0cc8-d5de-4084-88c5-940ca98aee09","kind":"finish","event":"orders.create","durMs":41,"module":"OrdersService","user":{"id":"customer-42"},"extra":{"orphanOp":false,"status":"ok"}}
{"level":"info","time":"2026-09-14T16:47:11.827Z","traceId":"8b7e6f5c-7b0f-4f5d-9d78-0c1c986b7ce6","opId":"1ffc0cc8-d5de-4084-88c5-940ca98aee09","kind":"finish","event":"http.request","durMs":42,"user":{"id":"customer-42"},"http":{"status":201},"extra":{"orphanOp":false}}
```

How to read it:

- `traceId` is shared by every line of the request; it came from the inbound `x-trace-id` header.
- `event` names the operation, `kind` tells which phase it is: `start`, `point`, `finish` or `error`.
- `opId` identifies one operation; `parentOpId` links `orders.create` to the enclosing `http.request`, giving you a span tree.
- `durMs` is computed on `finish` from the matching `start`.
- `extra.orphanOp` is `false` while an operation is open; a `point` or `finish` without a matching `start` gets `true`.

## Runtime Requirements

- Node.js 20+ (Node 18 reached end of life in April 2025)
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

  // `runWith` scopes the store to this request; `enter` would leak it into later requests.
  ctx.runWith(store, () => {
    core.emit({
      level: 'info',
      time: new Date().toISOString(),
      traceId,
      event: 'http.request.start',
      msg: `${req.method} ${req.originalUrl}`,
      http: { method: req.method, url: req.originalUrl },
    });

    next();
  });
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

Register the middleware (context creation) and the interceptor (request lifecycle events):

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HttpContextInterceptor, HttpContextMiddleware } from '@contextual-logger/nodejs';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpContextInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpContextMiddleware).forRoutes('*');
  }
}
```

Both pieces scope the store with `AsyncLocalStorage.run`, so a request's context can never leak into another request. The inbound trace id is taken from `x-trace-id` or a W3C `traceparent` header, and echoed back in the `x-trace-id` response header. Inbound ids are validated first (at most 128 characters of `A-Z a-z 0-9 . _ : -`); anything else is ignored and a fresh id is generated, so clients cannot inject arbitrary text into logs or response headers.

The `http.request` error event carries the status a filter or handler already set on the response, otherwise the `HttpException` status, otherwise 500.

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

Behind the scenes `@OpLogged` emits three kinds of records, all with `event: 'payments.charge'`:

- `kind: 'start'` when the method begins, carrying `module` and whatever `extra(args)` returns
- `kind: 'finish'` with automatically calculated `durMs` on success, plus `onSuccess(result)` fields
- `kind: 'error'` on failure with the normalised exception, plus `onError(err)` fields; the exception is rethrown unchanged

The decorator reads its dependencies from the decorated instance: by default `this.log` (an `OpLoggerService`) and `this.opCtx` (an `OpContextService`, only needed for `userId`/`userParamIndex`). If your service names them differently, point the decorator at them:

```ts
@OpLogged('payments.charge', {
  module: 'Payments',
  logger: (self) => (self as PaymentService).telemetry,
  context: (self) => (self as PaymentService).tracing,
})
```

When no logger can be resolved the method runs unlogged; logging never breaks a business call. Register `LoggerModule.forRoot(...)` and, for HTTP scenarios, `HttpContextMiddleware`/`HttpContextInterceptor` so the decorator's events land in the request's trace.

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

| Option             | Type                         | Description                                                                           |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------------- |
| `transports`       | `LoggerTransport[]`          | Destination sinks (console, Logtail, custom).                                         |
| `processors`       | `LoggerProcessor[]`          | Event mutators (e.g. sanitisation, enrichment).                                       |
| `onTransportError` | `(transport, error) => void` | Optional hook invoked when a transport throws. Use for metrics, retries, or alerting. |

When omitted, the module registers a default `ConsoleTransport` (warn+ to `stderr`). Pass an empty array to disable all transports.

### `LoggerModule.forRootAsync(options)`

Resolve the options from other providers, e.g. tokens and DSNs from `ConfigService`:

```ts
LoggerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    transports: [
      new ConsoleTransport({ minLevel: config.get('LOG_LEVEL', 'info') }),
      new LogtailTransport({
        sourceToken: config.getOrThrow('LOGTAIL_TOKEN'),
        endpoint: config.getOrThrow('LOGTAIL_HOST'),
        minLevel: 'info',
      }),
    ],
    processors: [new SanitizeProcessor()],
  }),
});
```

`useFactory` may be async. `extraProviders` adds providers visible to the factory.

### Injection tokens

Exported from the package so you can inject the resolved configuration:

| Token                  | Value                                                       |
| ---------------------- | ----------------------------------------------------------- |
| `LOGGER_OPTIONS`       | The resolved `LoggerModuleOptions`.                         |
| `LOGGER_TRANSPORTS`    | `LoggerTransport[]` in use (defaults applied).              |
| `LOGGER_PROCESSORS`    | `LoggerProcessor[]` in use.                                 |
| `LOGGER_ERROR_HANDLER` | `onTransportError` or `undefined`.                          |
| `LOGGER_SERVICE_ALIAS` | The string `'LoggerService'`, aliased to `OpLoggerService`. |

Exports: `OpLoggerService`, `OpContextService`, `CoreLoggerService`, `HttpContextMiddleware` and the tokens above. The module also aliases `Logger` and the `'LoggerService'` token to `OpLoggerService` so existing Nest code can inject the standard logger contract.

Use the framework-agnostic `OpContext` class from `@contextual-logger/nodejs/core` when wiring the logger in plain Node.js services.

### `OpLoggerService`

All four methods take `fields: OpFields`, i.e. any subset of `module`, `code`, `msg`, `durMs`, `http`, `db`, `err`, `extra`. Level, time, trace and op ids, `kind` and `user` are filled in by the logger from the current context.

- `start(event, fields)` – begin an operation and push a new `opId` onto the context stack.
- `finish(event, fields)` – mark completion, automatically computing `durMs`. Operations close LIFO; finishing an event other than the innermost open one still closes the innermost op but stamps `extra.opMismatch` with the event that was actually closed, so unbalanced pairs show up in the logs.
- `point(level, event, fields)` – emit standalone measurement/annotation.
- `error(event, err, fields)` – normalise errors, capture stacks and orphan operations. Any NestJS `HttpException` (400, 403, 404, ...) is captured with `err.status` and `err.response`.
- Legacy helpers (`log`, `warn`, `debug`, `verbose`, `fatal`) remain for compatibility. `error` accepts both the structured form `error(event, err, fields?)` and Nest's `error(message, stack?, context?)`: a call is treated as structured when the second argument is not a string.
- `run(traceId, fn, { userId })` — run `fn` inside a fresh trace scope (jobs, queue consumers, CLI commands). The scope ends with `fn`.
- `seed(traceId, { userId })` — **deprecated**, use `run`. It relies on `enterWith`, which never exits; called from a shared context such as application bootstrap it leaks the store into every later async task.
- `setUser(userId)` — update the bound user id for the current trace.

### `OpContext` / `OpContextService`

- `OpContext` (core) exposes `run(traceId, fn, { userId })`, `runWith(store, fn)`, `beginOp(opId?, event?)`, `endOp()`, `setUser(id)` for AsyncLocalStorage management. `enter(store)` is **deprecated**: it is unscoped and leaks into all subsequent async work.
- `OpContextService` (Nest) extends `OpContext` and is registered as an injectable for request-scoped scenarios.

### `CoreLoggerService`

Low-level engine that fans out `LogEvent` objects to transports. Useful when you need structured logging outside of operation lifecycle (e.g. infrastructure code). It has no framework dependencies; call `close()` on shutdown to flush and dispose transports. Inside NestJS the module registers `NestCoreLoggerService` under the same token, which calls `close()` from `onModuleDestroy`.

`debug/info/warn/error/fatal(msg, fields?)` and `log(level, msg, fields?)` accept any subset of `LogEvent` fields (`LogFields`); `traceId` defaults to an empty string and `event` to the level name when omitted. `child(moduleName)` returns a `ChildLogger` with the same methods that stamps `module` on every event.

### Transports & Processors

- `ConsoleTransport` – configurable stream & minimum level (defaults to warn → `stderr`). Calls `flush()` and `dispose()` even though they are no-ops by default so you can extend the transport safely.
- `LogtailTransport` (`@contextual-logger/nodejs/transports/logtail`) – forwards events to Logtail; `{ sourceToken, endpoint, minLevel?, name? }`, needs `@logtail/node`.
- `SentryTransport` (`@contextual-logger/nodejs/transports/sentry`) – forwards `error`+ events to Sentry; needs `@sentry/node`, see below.
- `ServiceInfoProcessor` – stamps `service: { name, version, env, hostname, pid }` on every event. `env` defaults to `NODE_ENV`, `hostname` to `os.hostname()`, `pid` to `process.pid`; each can be overridden or disabled: `new ServiceInfoProcessor({ name: 'orders-api', version: pkg.version, hostname: false })`. Logtail receives it as `service`, Sentry as the `service`, `version` and `env` tags.
- `SanitizeProcessor` – deep-clones events, redacts values under sensitive keys (`password`, `token`, `authorization`, `apiKey`, `cookie`, `ssn`, `creditCard`, ... see `DEFAULT_SENSITIVE_KEYS`; matching ignores case and separators) and sensitive substrings inside strings (`Bearer <token>`, JWTs). `Error` values keep name, message, stack, cause and own fields; `Map` becomes an object (keys redacted too), `Set` an array, buffers a `[Buffer N bytes]` placeholder.

  ```ts
  new SanitizeProcessor({
    keys: ['internalNote', 'x-signature'], // merged into the defaults (extendDefaults: false to replace them)
    valuePatterns: [...DEFAULT_SENSITIVE_VALUE_PATTERNS, /\b\d{16}\b/g], // [] disables value redaction
    replacement: '***',
  });
  ```

- `safeStringify(value)` – the serialiser `ConsoleTransport` uses: never throws, marks cycles as `[Circular]`, stringifies `bigint`, keeps `Error` fields and flattens `Map`/`Set`. Use it in custom transports instead of `JSON.stringify`.

### Optional Transports

```ts
import * as Sentry from '@sentry/node';
import { LoggerModule } from '@contextual-logger/nodejs/nestjs';
import { LogtailTransport } from '@contextual-logger/nodejs/transports/logtail';
import { SentryTransport } from '@contextual-logger/nodejs/transports/sentry';

Sentry.init({ dsn: process.env.SENTRY_DSN }); // the transport never initialises the SDK itself

LoggerModule.forRoot({
  transports: [
    new LogtailTransport({ sourceToken: process.env.LOGTAIL_TOKEN!, endpoint: process.env.LOGTAIL_HOST! }),
    new SentryTransport({ minLevel: 'error' }),
  ],
});
```

`SentryTransport` options:

| Option            | Default        | Description                                                                                            |
| ----------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `client`          | `@sentry/node` | Any object with `captureException`, `captureMessage` and optional `flush` (tests, other SDK flavours). |
| `minLevel`        | `'error'`      | Lowest level forwarded.                                                                                |
| `captureMessages` | `true`         | Send events without an `err` payload as Sentry messages; set `false` to forward exceptions only.       |
| `flushTimeoutMs`  | `2000`         | Timeout passed to `Sentry.flush` on shutdown.                                                          |

Events with `err` (or `kind: 'error'`) are rebuilt into an `Error` with the original name and stack so Sentry groups them correctly. `traceId`, `opId`, `module`, `event` and `code` become tags; `http`, `db`, `durMs` and `extra` land in the event's extra data; `user.id` is set as the Sentry user.

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

- `src/core` contains the framework-agnostic runtime: types, `ConsoleTransport`, processors, and the `CoreLoggerService`. It imports nothing outside Node.js built-ins.
- `src/adapters/nestjs` wires the core pieces into NestJS (`LoggerModule`, `HttpContextMiddleware`, `HttpContextInterceptor`, `OpLoggerService`, `OpContextService` as an `OpContext` wrapper, `NestCoreLoggerService` for lifecycle hooks).
- `src/transports/<name>` holds one third-party sink per directory. Each depends only on `core` and its own SDK, is exposed as `@contextual-logger/nodejs/transports/<name>`, and is never re-exported from the root. This keeps the layout ready to split a transport into its own package later without touching consumers' import paths beyond the package name.
- Adding a transport: create `src/transports/<name>/index.ts`, add the SDK as an optional peer (and dev) dependency, add the entry to `exports` and `typesVersions` in `package.json`, and write its tests under `test/transports-<name>.spec.ts`.

## Development

Common scripts:

- `npm run build` – compile TypeScript to `dist/`.
- `npm run test` – run the Jest suite, including an end-to-end test that boots a real NestJS application (`test/nest.e2e.spec.ts`) and checks trace propagation through middleware, guard, interceptor, `@OpLogged` and the service.
- `npm run lint` / `npm run format` – quality gates (`src`, `test` and `examples`).
- `npm run typecheck` – type-checks the library, the tests and the examples.

A husky pre-commit hook runs `lint-staged` (ESLint + Prettier on staged files). Hooks are installed by `npm install` via the `prepare` script; set `HUSKY=0` to skip them, e.g. in CI or Docker.

### Transport Lifecycle Guidance

`CoreLoggerService` keeps one delivery queue per transport: a transport receives events strictly in emit order, and a slow transport never delays the others. A failing delivery is reported and the queue keeps moving. `await logger.drain()` resolves once everything emitted so far has been handed to every transport.

Transports may buffer or batch events. `CoreLoggerService.close()` (called by the NestJS module on application shutdown) first drains the queues, then invokes two lifecycle hooks:

- `flush()` should resolve once all queued events are sent (e.g. drain buffers or finish retries).
- `dispose()` should release external resources (close connections, stop timers, tear down workers).

A transport that throws from either hook is reported through `onTransportError` (or stderr) and does not stop the remaining transports from being flushed and disposed.

`ConsoleTransport` writes without blocking the caller, but honours the stream's backpressure on shutdown: if the stream reported it was saturated, `flush()` waits for `drain` (up to `drainTimeoutMs`, default 1000 ms) so buffered lines reach a slow pipe before the process exits. Outside NestJS, call `CoreLoggerService.close()` yourself on shutdown.

Use the `onTransportError` hook (or implement your own inside a transport) to emit metrics, trigger retries, or surface alerts when a sink fails. A simple pattern is to enqueue the event for later retry inside the hook and log a warning via another transport.

### Resilience & Backoff Recommendations

- Wrap network transports with retry logic (e.g. exponential backoff, circuit breakers) to avoid hammering downstream vendors.
- Consider buffering events (in memory, Redis, or queue) when a transport is temporarily unavailable.
- Use `LoggerTransport.flush()` for graceful shutdown: drain buffers and persist unsent batches.
- Expose transport health via metrics (`onTransportError` hook + counter) so operators know when sinks fail.
- Validate these patterns against the runnable examples in `examples/custom-transport.ts` to ensure behaviour matches expectations before rolling to production.

### Manual Context Seeding

Outside an AsyncLocalStorage scope `OpLoggerService` stamps each event with a fresh one-off trace id and `extra.orphanOp: true`; it deliberately does not bind that id to the current execution, because doing so from bootstrap code would leak into every later request. For explicit control (cron jobs, message consumers), call:

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
- The release workflow (`.github/workflows/release.yml`) is triggered by `workflow_run` once the CI workflow succeeds on `main`, so a red CI never publishes. Its essential steps:

```yaml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0 # semantic-release needs the previous tag
  - uses: actions/setup-node@v4
    with:
      node-version: 22
      registry-url: https://registry.npmjs.org
  - run: npm install -g npm@latest # trusted publishing needs npm >= 11.5.1
  - run: npm ci
  - run: npm run build
  - run: npx semantic-release
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      NPM_CONFIG_PROVENANCE: true
```

- Ensure the workflow declares `permissions: { id-token: write }` so npm can issue a trusted publishing token, and register the repository/workflow as a trusted publisher in the npm package settings. The package must exist on npm first: publish the initial version manually with `npm publish --access public`.
- Use `npm run release -- --dry-run` locally to verify configuration before enabling CI publishes.

## Security & Privacy Notes

- Sanitisation is opt-in: include `SanitizeProcessor` to redact secrets.
- Error handling in transports is isolated; failures are reported to `stderr` but do not break the request flow.
- Custom transports should handle retries, backoff, and network failures gracefully.

## License

MIT © 2025
