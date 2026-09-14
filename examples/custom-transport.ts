import type { LogEvent, LoggerTransport } from '../src';
import { CoreLoggerService, OpContextService, OpLoggerService } from '../src';

class MemoryTransport implements LoggerTransport {
  readonly name = 'memory';
  readonly events: LogEvent[] = [];

  log(event: LogEvent): void {
    this.events.push(event);
  }
}

async function main(): Promise<void> {
  const transport = new MemoryTransport();
  const core = new CoreLoggerService([transport]);
  const ctx = new OpContextService();
  const logger = new OpLoggerService(ctx, core);

  await ctx.run('trace-demo', async () => {
    ctx.setUser('user-42');

    logger.start('jobs.process');
    logger.point('info', 'jobs.process', { msg: 'Working...', extra: { step: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    logger.finish('jobs.process', { msg: 'All done!', extra: { processed: 3 } });
  });

  console.log('Captured events:', transport.events);
}

void main();
