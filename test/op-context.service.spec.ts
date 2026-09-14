import { OpContextService } from '../src';

describe('OpContextService', () => {
  let service: OpContextService;

  beforeEach(() => {
    service = new OpContextService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Run `fn` inside a fresh store so the stack helpers have something to work on. */
  const inStore = <T>(fn: () => T, traceId = 't'): T => service.runWith(service.create(traceId), fn);

  it('enter() binds a store to the current execution (deprecated, kept for compatibility)', () => {
    const store = service.create('trace-123', 'user-1');
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the deprecated API is the subject of this test
    service.enter(store);

    expect(service.traceId()).toBe('trace-123');
    expect(service.get()?.user?.id).toBe('user-1');
  });

  it('maintains operation stack', () => {
    inStore(() => {
      const opA = service.beginOp('a');
      const opB = service.beginOp('b');

      expect(service.currentOp()).toBe(opB);
      expect(service.parentOp()).toBe(opA);

      const { opId: firstEnded } = service.endOp();
      expect(firstEnded).toBe(opB);
      const { opId: secondEnded } = service.endOp();
      expect(secondEnded).toBe(opA);
    });
  });

  it('remembers the event an op was started with and returns it on endOp', () => {
    inStore(() => {
      service.beginOp('op-1', 'orders.create');
      service.beginOp('op-2');

      expect(service.endOp()).toEqual({ opId: 'op-2', startedAt: expect.any(Number), event: undefined });
      expect(service.endOp()).toEqual({
        opId: 'op-1',
        startedAt: expect.any(Number),
        event: 'orders.create',
      });
      expect(service.endOp()).toEqual({});
    });
  });

  it('records start times for operations', () => {
    inStore(() => {
      const now = Date.now();
      jest
        .spyOn(Date, 'now')
        .mockReturnValueOnce(now)
        .mockReturnValueOnce(now + 25);

      const opId = service.beginOp('operation');
      expect(service.startedAt(opId)).toBe(now);

      const { opId: ended, startedAt } = service.endOp();
      expect(ended).toBe(opId);
      expect(startedAt).toBe(now);
    });
  });

  it('run helper establishes scoped trace id and user', () => {
    let seen: string | undefined;
    let user: string | undefined;
    service.run(
      'trace-runner',
      () => {
        seen = service.traceId();
        user = service.get()?.user?.id;
      },
      { userId: 'u-1' },
    );

    expect(seen).toBe('trace-runner');
    expect(user).toBe('u-1');
    expect(service.traceId()).toBeUndefined();
  });

  it('scope utility auto-closes operations', async () => {
    await inStore(async () => {
      const opSpy = jest.spyOn(service, 'endOp');

      await service.scope(() => {
        expect(service.currentOp()).toBeDefined();
      });

      expect(opSpy).toHaveBeenCalled();
      expect(service.currentOp()).toBeUndefined();
    }, 'trace-scope');
  });

  it('is a no-op outside any store', () => {
    expect(service.beginOp('x')).toBe('x');
    expect(service.endOp()).toEqual({});
    expect(service.currentOp()).toBeUndefined();
    expect(service.parentOp()).toBeUndefined();
    service.setUser('ignored');
    expect(service.get()).toBeUndefined();
  });
});
