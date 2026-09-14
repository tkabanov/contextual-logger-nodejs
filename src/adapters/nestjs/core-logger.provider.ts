import { Injectable, type OnModuleDestroy } from '@nestjs/common';

import { CoreLoggerService } from '../../core/core-logger.service';

/**
 * NestJS-aware `CoreLoggerService`: flushes and disposes transports when the
 * application shuts down. Registered under the `CoreLoggerService` token, so
 * consumers inject `CoreLoggerService` and stay framework-agnostic.
 */
@Injectable()
export class NestCoreLoggerService extends CoreLoggerService implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
