import { OpContextService, OpLogged, OpLoggerService } from '../src';

describe('@OpLogged decorator', () => {
  let logMock: { start: jest.Mock; finish: jest.Mock; error: jest.Mock };
  let ctxMock: { setUser: jest.Mock };

  beforeEach(() => {
    logMock = {
      start: jest.fn(),
      finish: jest.fn(),
      error: jest.fn(),
    };
    ctxMock = {
      setUser: jest.fn(),
    };
  });

  class Service {
    constructor(
      public readonly log: Partial<OpLoggerService>,
      public readonly opCtx: Partial<OpContextService>,
    ) {}

    @OpLogged('orders.create', {
      module: 'OrdersService',
      userParamIndex: 0,
      extra: () => ({ scope: 'service' }),
      onSuccess: (result: string) => ({ extra: { outcome: result } }),
      onError: (err: unknown) => ({ extra: { reason: (err as Error).message } }),
    })
    create(user: { id?: string }, amount: number): string {
      return `created-${amount}`;
    }

    @OpLogged('orders.async', {
      module: 'AsyncOrders',
      userId: () => 'explicit-user',
      onSuccess: (result: string) => ({ extra: { value: result } }),
    })
    createAsync(): Promise<string> {
      return Promise.resolve('async-ok');
    }

    @OpLogged('orders.fail', { module: 'OrdersService' })
    fail(): void {
      throw new Error('sync-failure');
    }

    @OpLogged('orders.failAsync', {
      module: 'OrdersService',
      onError: (err) => ({ extra: { reason: (err as Error).message } }),
    })
    failAsync(): Promise<void> {
      return Promise.reject(new Error('async-failure'));
    }
  }

  const createService = () => new Service(logMock, ctxMock);

  it('logs start and finish for synchronous success, seeding user from argument', () => {
    const service = createService();

    const result = service.create({ id: 'user-1' }, 42);

    expect(result).toBe('created-42');
    expect(ctxMock.setUser).toHaveBeenCalledWith('user-1');
    expect(logMock.start).toHaveBeenCalledWith('orders.create', {
      module: 'OrdersService',
      extra: { scope: 'service' },
    });
    expect(logMock.finish).toHaveBeenCalledWith(
      'orders.create',
      expect.objectContaining({
        module: 'OrdersService',
        extra: { outcome: 'created-42' },
      }),
    );
  });

  it('prefers explicit userId resolver and works with async success', async () => {
    const service = createService();
    ctxMock.setUser.mockClear();

    const value = await service.createAsync();

    expect(value).toBe('async-ok');
    expect(ctxMock.setUser).toHaveBeenCalledWith('explicit-user');
    expect(logMock.start).toHaveBeenCalledWith('orders.async', {
      module: 'AsyncOrders',
      extra: undefined,
    });
    expect(logMock.finish).toHaveBeenCalledWith(
      'orders.async',
      expect.objectContaining({
        module: 'AsyncOrders',
        extra: { value: 'async-ok' },
      }),
    );
  });

  it('logs error for synchronous failures and rethrows', () => {
    const service = createService();

    expect(() => service.fail()).toThrow('sync-failure');

    expect(logMock.error).toHaveBeenCalledWith(
      'orders.fail',
      expect.any(Error),
      expect.objectContaining({ module: 'OrdersService' }),
    );
    expect(logMock.finish).not.toHaveBeenCalled();
  });

  it('locates dependencies through the logger/context resolver options', () => {
    class Renamed {
      constructor(
        private readonly telemetry: Partial<OpLoggerService>,
        private readonly tracing: Partial<OpContextService>,
      ) {}

      @OpLogged('renamed.op', {
        logger: (self) => (self as Renamed).telemetry as OpLoggerService,
        context: (self) => (self as Renamed).tracing as OpContextService,
        userId: () => 'u-9',
      })
      run(): number {
        return 7;
      }
    }

    expect(new Renamed(logMock, ctxMock).run()).toBe(7);
    expect(ctxMock.setUser).toHaveBeenCalledWith('u-9');
    expect(logMock.start).toHaveBeenCalledWith('renamed.op', expect.anything());
    expect(logMock.finish).toHaveBeenCalledWith('renamed.op', expect.anything());
  });

  it('runs the method unlogged when no logger can be resolved', () => {
    class Bare {
      @OpLogged('bare.op', {
        logger: () => {
          throw new Error('resolver exploded');
        },
      })
      run(): string {
        return 'still works';
      }
    }

    expect(new Bare().run()).toBe('still works');
    expect(logMock.start).not.toHaveBeenCalled();
  });

  it('logs error for async failures and preserves rejection', async () => {
    const service = createService();

    await expect(service.failAsync()).rejects.toThrow('async-failure');

    expect(logMock.error).toHaveBeenCalledWith(
      'orders.failAsync',
      expect.any(Error),
      expect.objectContaining({
        module: 'OrdersService',
        extra: { reason: 'async-failure' },
      }),
    );
  });
});
