import { OpContextService } from '../src';

describe('OpContextService', () => {
  let service: OpContextService;

  beforeEach(() => {
    service = new OpContextService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates and enters new context', () => {
    const store = service.create('trace-123', 'user-1');
    service.enter(store);

    expect(service.traceId()).toBe('trace-123');
    expect(service.get()?.user?.id).toBe('user-1');
  });

  it('maintains operation stack', () => {
    service.enter(service.create('t')); // ensure ALS available

    const opA = service.beginOp('a');
    const opB = service.beginOp('b');

    expect(service.currentOp()).toBe(opB);
    expect(service.parentOp()).toBe(opA);

    const { opId: firstEnded } = service.endOp();
    expect(firstEnded).toBe(opB);
    const { opId: secondEnded } = service.endOp();
    expect(secondEnded).toBe(opA);
  });

  it('remembers the event an op was started with and returns it on endOp', () => {
    service.enter(service.create('t'));
    service.beginOp('op-1', 'orders.create');
    service.beginOp('op-2');

    expect(service.endOp()).toEqual({ opId: 'op-2', startedAt: expect.any(Number), event: undefined });
    expect(service.endOp()).toEqual({ opId: 'op-1', startedAt: expect.any(Number), event: 'orders.create' });
    expect(service.endOp()).toEqual({});
  });

  it('records start times for operations', () => {
    service.enter(service.create('t'));
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

  it('run helper establishes scoped trace id', () => {
    let seen: string | undefined;
    service.run('trace-runner', () => {
      seen = service.traceId();
    });

    expect(seen).toBe('trace-runner');
    expect(service.traceId()).toBeUndefined();
  });

  it('scope utility auto-closes operations', async () => {
    service.enter(service.create('trace-scope'));
    const opSpy = jest.spyOn(service, 'endOp');

    await service.scope(() => {
      expect(service.currentOp()).toBeDefined();
    });

    expect(opSpy).toHaveBeenCalled();
    expect(service.currentOp()).toBeUndefined();
  });
});
