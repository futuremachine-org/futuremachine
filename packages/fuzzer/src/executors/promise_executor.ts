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
  createMethod<T extends (...args: any[]) => any>(
    methodName: string,
    methodExecutor: T
  ): T {
    return methodExecutor;
  }
  build(): void {}

  bindArgs<A extends unknown[], B extends unknown[], R>(
    func: (...args: [...A, ...B]) => R,
    ...args: A
  ): (...args: B) => R {
    return (...unboundArgs: B) => func(...args, ...unboundArgs);
  }

  createTestObject(): TestObject {
    return {
      value: 0,
    };
  }
  ignoreErrors(deferred: Promise<unknown>): void {
    deferred.catch(() => {});
  }
  getDeferredClass(): new (...args: unknown[]) => Promise<unknown> {
    return Promise as new (...args: unknown[]) => Promise<unknown>;
  }

  withResolvers(): DeferredResolvers<Promise<unknown>, PromiseId> {
    const { promise, resolve, reject } = Promise.withResolvers();

    return {
      deferred: promise,
      resolve,
      reject,
      id: { resolve, reject },
    };
  }
  resolve(value: unknown): Promise<unknown> {
    return Promise.resolve(value);
  }
  reject(value: unknown): Promise<unknown> {
    return Promise.reject(value);
  }
  resolveFutureById(id: PromiseId, value: unknown): void {
    id.resolve(value);
  }
  rejectFutureById(id: PromiseId, reason: unknown): void {
    id.reject(reason);
  }
  race(value: Iterable<unknown>): Promise<unknown> {
    return Promise.race(value);
  }
  all(value: Iterable<unknown>): Promise<unknown> {
    return Promise.all(value);
  }
  any(value: Iterable<unknown>): Promise<unknown> {
    return Promise.any(value);
  }
  allSettled(value: Iterable<unknown>): Promise<unknown> {
    return Promise.allSettled(value);
  }
  try(func: (...args: unknown[]) => unknown): Promise<unknown> {
    const { promise, resolve, reject } = Promise.withResolvers();
    promise.catch(() => {});
    try {
      resolve(func());
    } catch (e) {
      reject(e);
    }
    return promise;
  }
  flush(): Promise<void> {
    // Schedule a macrotask which is guaranteed to be triggered after all
    // microtasks.
    const { promise, resolve } = Promise.withResolvers<void>();

    setTimeout(resolve, 0);

    return promise;
  }

  deferredNext(
    deferred: Promise<unknown>,
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (value: unknown) => unknown
  ): Promise<unknown> {
    return deferred.then(onFulfilled, onRejected);
  }
  deferredCatch(
    deferred: Promise<unknown>,
    onRejected?: (value: unknown) => unknown
  ): Promise<unknown> {
    return deferred.catch(onRejected);
  }
  deferredFinally(
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
  createContext(): PromiseExecutorContext {
    return new PromiseExecutorContext();
  }
}
