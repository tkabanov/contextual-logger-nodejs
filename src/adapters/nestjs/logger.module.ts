import {
  type DynamicModule,
  type FactoryProvider,
  Global,
  Logger,
  Module,
  type ModuleMetadata,
  type Provider,
} from '@nestjs/common';

import { CoreLoggerService, type LoggerTransportErrorHandler } from '../../core/core-logger.service';
import type { LoggerProcessor } from '../../core/logger-processor.interface';
import { ConsoleTransport } from '../../core/transports/console.transport';
import type { LoggerTransport } from '../../core/transports/transport.interface';
import { NestCoreLoggerService } from './core-logger.provider';
import { HttpContextMiddleware } from './http-context.middleware';
import {
  LOGGER_ERROR_HANDLER,
  LOGGER_OPTIONS,
  LOGGER_PROCESSORS,
  LOGGER_SERVICE_ALIAS,
  LOGGER_TRANSPORTS,
} from './logger.tokens';
import { OpContextService } from './op-context.service';
import { OpLoggerService } from './op-logger.service';

export interface LoggerModuleOptions {
  /** Destination sinks. Defaults to a single `ConsoleTransport` (warn+ to stderr). Pass `[]` to disable. */
  transports?: LoggerTransport[];
  processors?: LoggerProcessor[];
  onTransportError?: LoggerTransportErrorHandler;
}

export interface LoggerModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  /** Builds the options, typically from `ConfigService`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useFactory: (...args: any[]) => Promise<LoggerModuleOptions> | LoggerModuleOptions;
  /** Dependencies injected into `useFactory`, in order. */
  inject?: FactoryProvider['inject'];
  /** Additional providers made available to the factory. */
  extraProviders?: Provider[];
}

@Global()
@Module({})
export class LoggerModule {
  static forRoot(opts: LoggerModuleOptions = {}): DynamicModule {
    return LoggerModule.build([{ provide: LOGGER_OPTIONS, useValue: opts }], []);
  }

  /**
   * Resolve options asynchronously, e.g. Logtail tokens or a Sentry DSN from
   * `ConfigService`:
   *
   * ```ts
   * LoggerModule.forRootAsync({
   *   imports: [ConfigModule],
   *   inject: [ConfigService],
   *   useFactory: (config: ConfigService) => ({ transports: [new ConsoleTransport({ minLevel: config.get('LOG_LEVEL') })] }),
   * })
   * ```
   */
  static forRootAsync(opts: LoggerModuleAsyncOptions): DynamicModule {
    const optionsProvider: FactoryProvider<LoggerModuleOptions> = {
      provide: LOGGER_OPTIONS,
      useFactory: opts.useFactory,
      inject: opts.inject ?? [],
    };
    return LoggerModule.build([optionsProvider, ...(opts.extraProviders ?? [])], opts.imports ?? []);
  }

  private static build(
    optionProviders: Provider[],
    imports: NonNullable<ModuleMetadata['imports']>,
  ): DynamicModule {
    const providers: Provider[] = [
      ...optionProviders,
      {
        provide: LOGGER_TRANSPORTS,
        useFactory: (o: LoggerModuleOptions) => o.transports ?? [new ConsoleTransport()],
        inject: [LOGGER_OPTIONS],
      },
      {
        provide: LOGGER_PROCESSORS,
        useFactory: (o: LoggerModuleOptions) => o.processors ?? [],
        inject: [LOGGER_OPTIONS],
      },
      {
        provide: LOGGER_ERROR_HANDLER,
        useFactory: (o: LoggerModuleOptions) => o.onTransportError,
        inject: [LOGGER_OPTIONS],
      },
      {
        provide: CoreLoggerService,
        useFactory: (
          transports: LoggerTransport[],
          processors: LoggerProcessor[],
          onError?: LoggerTransportErrorHandler,
        ) => new NestCoreLoggerService(transports, processors, onError),
        inject: [LOGGER_TRANSPORTS, LOGGER_PROCESSORS, LOGGER_ERROR_HANDLER],
      },
      OpContextService,
      OpLoggerService,
      HttpContextMiddleware,
      { provide: Logger, useExisting: OpLoggerService },
      { provide: LOGGER_SERVICE_ALIAS, useExisting: OpLoggerService },
    ];

    return {
      module: LoggerModule,
      imports,
      providers,
      exports: [
        OpContextService,
        OpLoggerService,
        CoreLoggerService,
        HttpContextMiddleware,
        Logger,
        LOGGER_SERVICE_ALIAS,
        LOGGER_OPTIONS,
        LOGGER_TRANSPORTS,
        LOGGER_PROCESSORS,
        LOGGER_ERROR_HANDLER,
      ],
    };
  }
}
