import {
  type DeferredResolvers,
  type Executor,
  type ExecutorContext,
  type TestObject,
} from '../executor_base.js';

type PromiseId = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

class PromiseExecutorContext implements ExecutorContext<
  Promise<unknown>,
  PromiseId
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public createMethod<T extends (...args: any[]) => any>(
    methodName: string,
    methodExecutor: T
  ): T {
    return methodExecutor;
  }
  public build(): void {}

  public bindArgs<A extends unknown[], B extends unknown[], R>(
    func: (...args: [...A, ...B]) => R,
    ...args: A
  ): (...args: B) => R {
    return (...unboundArgs: B) => func(...args, ...unboundArgs);
  }

  public createTestObject(): TestObject {
    return {
      value: 0,
    };
  }
  public ignoreErrors(deferred: Promise<unknown>): void {
    deferred.catch(() => {});
  }
  public getDeferredClass(): new (...args: unknown[]) => Promise<unknown> {
    return Promise as new (...args: unknown[]) => Promise<unknown>;
  }

  public withResolvers(): DeferredResolvers<Promise<unknown>, PromiseId> {
    const { promise, resolve, reject } = Promise.withResolvers();

    return {
      deferred: promise,
      resolve,
      reject,
      id: { resolve, reject },
    };
  }
  public resolve(value: unknown): Promise<unknown> {
    return Promise.resolve(value);
  }
  public reject(value: unknown): Promise<unknown> {
    return Promise.reject(value);
  }
  public resolveFutureById(id: PromiseId, value: unknown): void {
    id.resolve(value);
  }
  public rejectFutureById(id: PromiseId, reason: unknown): void {
    id.reject(reason);
  }
  public race(value: Iterable<unknown>): Promise<unknown> {
    return Promise.race(value);
  }
  public all(value: Iterable<unknown>): Promise<unknown> {
    return Promise.all(value);
  }
  public any(value: Iterable<unknown>): Promise<unknown> {
    return Promise.any(value);
  }
  public allSettled(value: Iterable<unknown>): Promise<unknown> {
    return Promise.allSettled(value);
  }
  public try(func: (...args: unknown[]) => unknown): Promise<unknown> {
    const { promise, resolve, reject } = Promise.withResolvers();
    promise.catch(() => {});
    try {
      resolve(func());
    } catch (e) {
      reject(e);
    }
    return promise;
  }
  public flush(): Promise<void> {
    // Schedule a macrotask which is guaranteed to be triggered after all
    // microtasks.
    const { promise, resolve } = Promise.withResolvers<void>();

    setTimeout(resolve, 0);

    return promise;
  }

  public deferredNext(
    deferred: Promise<unknown>,
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (value: unknown) => unknown
  ): Promise<unknown> {
    return deferred.then(onFulfilled, onRejected);
  }
  public deferredCatch(
    deferred: Promise<unknown>,
    onRejected?: (value: unknown) => unknown
  ): Promise<unknown> {
    return deferred.catch(onRejected);
  }
  public deferredFinally(
    deferred: Promise<unknown>,
    onFinally?: () => void
  ): Promise<unknown> {
    return deferred.finally(onFinally);
  }
}

export class PromiseExecutor implements Executor<
  Promise<unknown>,
  PromiseId,
  PromiseExecutorContext
> {
  public createContext(): PromiseExecutorContext {
    return new PromiseExecutorContext();
  }
}
