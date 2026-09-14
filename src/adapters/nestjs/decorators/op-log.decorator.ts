import type { LogEvent } from '../../../core/log.types';
import type { OpContextService } from '../op-context.service';
import type { OpLoggerService } from '../op-logger.service';

// Utility types
export type MaybePromise<T> = T | Promise<T>;
export type ExtraFn<A extends unknown[]> = (args: Readonly<A>) => Record<string, unknown> | undefined;
export type SuccessFn<R> = (result: R) => Partial<LogEvent> | undefined;
export type ErrorFn = (err: unknown) => Partial<LogEvent> | undefined;

export type OpLogOptions<A extends unknown[] = unknown[], R = unknown> = {
  /** Logical module name to stamp on logs. */
  module?: string;
  /**
   * Where to find the `OpLoggerService` on the decorated instance.
   * Defaults to `instance.log`. Pass a function when the field has another name.
   */
  logger?: (instance: object) => OpLoggerService | undefined;
  /**
   * Where to find the `OpContextService` on the decorated instance (used to bind
   * the user id). Defaults to `instance.opCtx`.
   */
  context?: (instance: object) => OpContextService | undefined;
  /** Position of an argument that carries `{ id?: string }`. */
  userParamIndex?: number;
  /** Explicit user id resolver. Has priority over `userParamIndex`. */
  userId?: (args: Readonly<A>) => string | undefined;
  /** Extra fields for all records of the wrapped call. */
  extra?: ExtraFn<A>;
  /** Extra fields for the finish record when the call succeeds. */
  onSuccess?: SuccessFn<R>;
  /** Extra fields for the error record when the call fails. */
  onError?: ErrorFn;
};

/**
 * Default field names `@OpLogged` looks up on the decorated instance. Override
 * per decorator with the `logger` / `context` options when your service names
 * them differently.
 */
export type WithOpLogging = Partial<{
  log: OpLoggerService;
  opCtx: OpContextService;
}>;

const defaultLogger = (instance: object): OpLoggerService | undefined => (instance as WithOpLogging).log;
const defaultContext = (instance: object): OpContextService | undefined => (instance as WithOpLogging).opCtx;

/**
 * Wraps a method with operation logging: start → (point|none) → finish|error.
 * Does not mutate the `event` name; phase is encoded by the logger via `kind`.
 */
export function OpLogged<A extends unknown[], R>(
  event: string,
  opts: OpLogOptions<A, R> = {},
): MethodDecorator {
  const {
    module: moduleName,
    userParamIndex,
    userId: userIdFn,
    extra,
    onSuccess,
    onError,
    logger: resolveLogger = defaultLogger,
    context: resolveContext = defaultContext,
  } = opts;

  const decorator: MethodDecorator = (_target, _propertyKey, descriptor) => {
    if (!descriptor) return;
    const typed = descriptor as unknown as TypedPropertyDescriptor<(...args: A) => MaybePromise<R>>;
    const original = typed.value;
    if (!original) return;

    typed.value = function (this: object, ...args: A): MaybePromise<R> {
      // Missing dependencies never break the business call: the method simply runs unlogged.
      const log = safeResolve(resolveLogger, this);
      const opCtx = safeResolve(resolveContext, this);

      // Resolve user id and attach to ALS context if available.
      try {
        const uid =
          (typeof userIdFn === 'function' ? userIdFn(args) : undefined) ??
          (typeof userParamIndex === 'number'
            ? (args[userParamIndex] as { id?: string } | undefined)?.id
            : undefined);
        if (uid) opCtx?.setUser(uid);
      } catch {
        // Never fail a business call due to logging side-effects.
      }

      const base: Partial<LogEvent> = { module: moduleName, extra: extra?.(args) };

      // Start operation (pushes opId into ALS).
      log?.start(event, base);

      // Call the original method.
      let result: MaybePromise<R>;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call
        result = original.apply(this, args);
      } catch (err) {
        const errFields = onError?.(err) ?? {};
        log?.error(event, err, { ...base, ...errFields });
        throw err;
      }

      // Async path.
      if (result instanceof Promise) {
        return result.then(
          (res) => {
            const successFields = onSuccess?.(res) ?? {};
            log?.finish(event, { ...base, ...successFields });
            return res;
          },
          (err) => {
            const errFields = onError?.(err) ?? {};
            log?.error(event, err, { ...base, ...errFields });
            throw err;
          },
        );
      }

      // Sync path.
      const successFields = onSuccess?.(result) ?? {};
      log?.finish(event, { ...base, ...successFields });
      return result;
    } as (...args: A) => MaybePromise<R>;
  };

  return decorator;
}

function safeResolve<T>(resolve: (instance: object) => T | undefined, instance: object): T | undefined {
  try {
    return resolve(instance);
  } catch {
    return undefined;
  }
}
