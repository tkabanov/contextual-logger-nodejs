import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type OperationContext = {
  traceId: string;
  opStack: string[];
  opTimes: Map<string, number>;
  /** Event name each op was started with, used to detect unbalanced start/finish pairs. */
  opEvents: Map<string, string>;
  user?: { id?: string };
};

export type EndedOperation = { opId?: string; startedAt?: number; event?: string };

/**
 * Framework-agnostic AsyncLocalStorage helper for trace and operation nesting.
 */
export class OpContext {
  private readonly als = new AsyncLocalStorage<OperationContext>();

  /** Create a fresh store object. */
  create(traceId: string, userId?: string): OperationContext {
    return {
      traceId,
      opStack: [],
      opTimes: new Map(),
      opEvents: new Map(),
      user: userId ? { id: userId } : undefined,
    };
  }

  /**
   * Enter the given store for the rest of the current synchronous execution and
   * everything spawned from it.
   *
   * @deprecated Use `run`/`runWith`, which scope the store to a callback.
   * `enterWith` never "exits": calling it from a long-lived context (bootstrap,
   * a shared event loop tick) leaks the store into every async task created
   * afterwards, including unrelated requests. Will be removed in the next major.
   */
  enter(store: OperationContext): void {
    this.als.enterWith(store); // Node 18+: sticks for all subsequent async work
  }

  /** Run fn inside a fresh store; the store is scoped to fn and its async descendants. */
  run<T>(traceId: string, fn: () => T, options: { userId?: string } = {}): T {
    return this.als.run(this.create(traceId, options.userId), fn);
  }

  /** Run fn inside an existing store (e.g. one created with `create`). */
  runWith<T>(store: OperationContext, fn: () => T): T {
    return this.als.run(store, fn);
  }

  get(): OperationContext | undefined {
    return this.als.getStore();
  }

  traceId(): string | undefined {
    return this.get()?.traceId;
  }

  setUser(id?: string): void {
    const s = this.get();
    if (s) s.user = { id };
  }

  beginOp(opId: string = randomUUID(), event?: string): string {
    const s = this.get();
    if (!s) return opId;
    s.opStack.push(opId);
    s.opTimes.set(opId, Date.now());
    if (event) s.opEvents?.set(opId, event);
    return opId;
  }

  endOp(): EndedOperation {
    const s = this.get();
    if (!s) return {};
    const opId = s.opStack.pop();
    if (!opId) return {};
    const startedAt = s.opTimes.get(opId);
    const event = s.opEvents?.get(opId);
    s.opTimes.delete(opId);
    s.opEvents?.delete(opId);
    return { opId, startedAt, event };
  }

  currentOp(): string | undefined {
    const s = this.get();
    if (!s) return undefined;
    const len = s.opStack.length;
    return len ? s.opStack[len - 1] : undefined;
  }

  parentOp(): string | undefined {
    const s = this.get();
    if (!s) return undefined;
    const len = s.opStack.length;
    return len > 1 ? s.opStack[len - 2] : undefined;
  }

  startedAt(opId: string): number | undefined {
    return this.get()?.opTimes.get(opId);
  }

  /** Optional utility: run fn under new op and auto-close. */
  async scope<T>(fn: () => Promise<T> | T): Promise<T> {
    this.beginOp();
    try {
      return await fn();
    } finally {
      this.endOp();
    }
  }
}
