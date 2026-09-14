import { HttpContextMiddleware, OpContextService } from '../src';

describe('HttpContextMiddleware', () => {
  let ctx: OpContextService;
  let middleware: HttpContextMiddleware;

  beforeEach(() => {
    ctx = new OpContextService();
    middleware = new HttpContextMiddleware(ctx);
  });

  it('creates a scoped store, propagates it through async work, and sets the header', async () => {
    const res = { setHeader: jest.fn() };
    let inNext: string | undefined;
    let afterAwait: string | undefined;

    await new Promise<void>((resolve) => {
      middleware.use({ headers: { 'x-trace-id': 'trace-mw' }, user: { id: 'u1' } }, res, () => {
        inNext = ctx.traceId();
        void Promise.resolve().then(() => {
          afterAwait = ctx.traceId();
          resolve();
        });
      });
    });

    expect(inNext).toBe('trace-mw');
    expect(afterAwait).toBe('trace-mw');
    expect(res.setHeader).toHaveBeenCalledWith('x-trace-id', 'trace-mw');
    expect(ctx.get()).toBeUndefined(); // no leak outside the request
  });

  it('replaces an over-long inbound trace id with a generated one', () => {
    const res = { setHeader: jest.fn() };
    let seen: string | undefined;
    middleware.use({ headers: { 'x-trace-id': 'a'.repeat(129) } }, res, () => {
      seen = ctx.traceId();
    });
    expect(seen).toHaveLength(36);
    expect(res.setHeader).toHaveBeenCalledWith('x-trace-id', seen);
  });

  it('generates a trace id when none is provided and keeps requests isolated', async () => {
    const seen: string[] = [];
    const request = (delay: number) =>
      new Promise<void>((resolve) => {
        middleware.use({ headers: {} }, { setHeader: jest.fn() }, () => {
          setTimeout(() => {
            seen.push(ctx.traceId() ?? 'missing');
            resolve();
          }, delay);
        });
      });

    await Promise.all([request(5), request(1)]);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toHaveLength(36);
    expect(seen[0]).not.toBe(seen[1]);
  });
});
