import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type OperationContext = {
  traceId: string;
  opStack: string[];
  opTimes: Map<string, number>;
  user?: { id?: string };
};

/**
 * Framework-agnostic AsyncLocalStorage helper for trace and operation nesting.
 */
export class OpContext {
  private readonly als = new AsyncLocalStorage<OperationContext>();

  /** Create a fresh store object. */
  create(traceId: string, userId?: string): OperationContext {
    return { traceId, opStack: [], opTimes: new Map(), user: userId ? { id: userId } : undefined };
  }

  /**
   * Enter the given store for the rest of the current synchronous execution and
   * everything spawned from it.
   *
   * Prefer `run`/`runWith`: `enterWith` never "exits", so calling it from a
   * long-lived context (bootstrap, a shared event loop tick) leaks the store into
   * every async task created afterwards, including unrelated requests.
   */
  enter(store: OperationContext): void {
    this.als.enterWith(store); // Node 18+: sticks for all subsequent async work
  }

  /** Run fn inside a fresh store; the store is scoped to fn and its async descendants. */
  run<T>(traceId: string, fn: () => T): T {
    return this.als.run(this.create(traceId), fn);
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

  beginOp(opId: string = randomUUID()): string {
    const s = this.get();
    if (!s) return opId;
    s.opStack.push(opId);
    s.opTimes.set(opId, Date.now());
    return opId;
  }

  endOp(): { opId?: string; startedAt?: number } {
    const s = this.get();
    if (!s) return {};
    const opId = s.opStack.pop();
    const startedAt = opId ? s.opTimes.get(opId) : undefined;
    if (opId) s.opTimes.delete(opId);
    return { opId, startedAt };
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
