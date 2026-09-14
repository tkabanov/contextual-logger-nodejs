/**
 * Injection tokens used by `LoggerModule`. Exported so applications and tests can
 * inject the resolved configuration (e.g. to add a transport dynamically or to
 * assert on it) without relying on private string literals.
 */

/** Resolved `LoggerModuleOptions` (after `forRoot` / `forRootAsync`). */
export const LOGGER_OPTIONS = Symbol('contextual-logger:options');
/** `LoggerTransport[]` in use. */
export const LOGGER_TRANSPORTS = Symbol('contextual-logger:transports');
/** `LoggerProcessor[]` in use. */
export const LOGGER_PROCESSORS = Symbol('contextual-logger:processors');
/** `LoggerTransportErrorHandler | undefined`. */
export const LOGGER_ERROR_HANDLER = Symbol('contextual-logger:error-handler');
/** String alias of `OpLoggerService` for code that injects Nest's `LoggerService` contract by name. */
export const LOGGER_SERVICE_ALIAS = 'LoggerService';
