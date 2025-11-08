import { DynamicModule, Global, Logger, Module, Provider } from '@nestjs/common';

import { CoreLoggerService, LoggerTransportErrorHandler } from '../../core/core-logger.service';
import { LoggerProcessor } from '../../core/logger-processor.interface';
import { OpContextService } from './op-context.service';
import { OpLoggerService } from './op-logger.service';
import { ConsoleTransport } from '../../core/transports/console.transport';
import { LoggerTransport } from '../../core/transports/transport.interface';

export interface LoggerModuleOptions {
  transports?: LoggerTransport[];
  processors?: LoggerProcessor[];
  onTransportError?: LoggerTransportErrorHandler;
}

const TRANSPORTS = 'LOGGER_TRANSPORTS';
const PROCESSORS = 'LOGGER_PROCESSORS';
const ERROR_HANDLER = 'LOGGER_ERROR_HANDLER';
const LOGGER_ALIAS = 'LoggerService';

@Global()
@Module({})
export class LoggerModule {
  static forRoot(opts: LoggerModuleOptions = {}): DynamicModule {
    const transports = opts.transports ?? [new ConsoleTransport()];
    const providers: Provider[] = [
      OpContextService,
      OpLoggerService,
      { provide: Logger, useExisting: OpLoggerService },
      { provide: LOGGER_ALIAS, useExisting: OpLoggerService },
      { provide: TRANSPORTS, useValue: transports },
      { provide: PROCESSORS, useValue: opts.processors ?? [] },
      { provide: ERROR_HANDLER, useValue: opts.onTransportError },
      {
        provide: CoreLoggerService,
        useFactory: (
          tps: LoggerTransport[],
          procs: LoggerProcessor[],
          onError?: LoggerTransportErrorHandler,
        ) => new CoreLoggerService(tps, procs, onError),
        inject: [TRANSPORTS, PROCESSORS, ERROR_HANDLER],
      },
    ];

    return {
      module: LoggerModule,
      providers,
      exports: [OpContextService, OpLoggerService, CoreLoggerService, Logger, LOGGER_ALIAS],
    };
  }
}
