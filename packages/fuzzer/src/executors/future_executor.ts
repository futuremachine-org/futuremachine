import type {
  FutureId,
  FutureMachine,
  Method,
  MethodMachine,
  Serializable,
  StateBuilder,
} from '@futuremachine/core';
import {
  createMethodMachine,
  Entity,
  Future,
  SimpleFutureDatabase,
} from '@futuremachine/core';
import {
  type DeferredResolvers,
  type Executor,
  type ExecutorContext,
  type TestObject,
} from '../executor_base.js';

type FutureExecutorContextState = {
  flushDatabase: Method<(futureMachine: FutureMachine) => Future<void>>;
  futureMachine: FutureMachine | undefined;
  methodMachine: MethodMachine;
};

class FutureExecutorContext
  extends Entity<FutureExecutorContextState>
  implements ExecutorContext<Future<Serializable>, FutureId<Serializable>>
{
  public getFutureMachine(): FutureMachine {
    if (this.get('futureMachine') === undefined) {
      throw new Error('Need to call build before calling getFutureMachine.');
    }
    return this.get('futureMachine')!;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public createMethod<T extends (...args: any[]) => any>(
    methodName: string,
    methodExecutor: T
  ): T {
    return this.get('methodMachine').methods.create(methodName, methodExecutor);
  }
  public build(): void {
    this.set('futureMachine', this.get('methodMachine').methods.build());
  }

  public bindArgs = (<
    A extends Serializable[],
    B extends unknown[],
    R extends Serializable,
  >(
    func: Method<(...args: [...A, ...B]) => R>,
    ...args: A
  ): ((...args: B) => R) => {
    return func.bindArgs(...args);
  }) as <A extends unknown[], B extends unknown[], R>(
    func: (...args: [...A, ...B]) => R,
    ...args: A
  ) => (...args: B) => R;

  public createTestObject(): TestObject {
    return this.get('methodMachine').containers.createStruct({
      value: 0,
    });
  }
  public ignoreErrors(_deferred: Future<Serializable>): void {}
  public getDeferredClass(): new (...args: unknown[]) => Future<Serializable> {
    return Future as unknown as new (
      ...args: unknown[]
    ) => Future<Serializable>;
  }

  public withResolvers(): DeferredResolvers<
    Future<Serializable>,
    FutureId<Serializable>
  > {
    const { future, resolve, reject, id } =
      this.getFutureMachine().withResolvers();

    return {
      deferred: future,
      resolve: resolve as (value: unknown) => void,
      reject: reject as (value: unknown) => void,
      id,
    };
  }
  public resolve(value: Serializable): Future<Serializable> {
    // TODO: I've had to cast this to any, because Serializable can't be passed
    // into resolve. Need to fix that.
    //
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.getFutureMachine().resolve(value as any);
  }
  public reject(value: Serializable): Future<Serializable> {
    return this.getFutureMachine().reject(value);
  }
  public resolveFutureById(id: FutureId<Serializable>, value: unknown): void {
    this.getFutureMachine().resolveFutureById(
      id,
      // TODO: I've had to cast this to any, because Serializable can't be
      // passed into resolveFutureById. Need to fix that.
      //
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      value as any
    );
  }
  public rejectFutureById(
    id: FutureId<Serializable>,
    reason: Serializable
  ): void {
    this.getFutureMachine().rejectFutureById(id, reason);
  }
  public race(value: Iterable<Serializable>): Future<Serializable> {
    return this.getFutureMachine().race(value);
  }
  public all(value: Iterable<Serializable>): Future<Serializable> {
    return this.getFutureMachine().all(value) as Future<Serializable>;
  }
  public any(value: Iterable<Serializable>): Future<Serializable> {
    return this.getFutureMachine().any(value);
  }
  public allSettled(value: Iterable<Serializable>): Future<Serializable> {
    return this.getFutureMachine().allSettled(value) as Future<Serializable>;
  }
  public try(
    func: Method<(...args: unknown[]) => Serializable>
  ): Future<Serializable> {
    return this.getFutureMachine().try(func);
  }
  public flush(): Promise<void> {
    return this.get('flushDatabase')(this.getFutureMachine()).getPromise();
  }

  public deferredNext(
    deferred: Future<Serializable>,
    onFulfilled?: Method<(value: unknown) => Serializable>,
    onRejected?: Method<(value: unknown) => Serializable>
  ): Future<Serializable> {
    return deferred.next(onFulfilled, onRejected);
  }
  public deferredCatch(
    deferred: Future<Serializable>,
    onRejected?: Method<(value: unknown) => Serializable>
  ): Future<Serializable> {
    return deferred.catch(onRejected);
  }
  public deferredFinally(
    deferred: Future<Serializable>,
    onFinally?: Method<() => void>
  ): Future<Serializable> {
    return deferred.finally(onFinally);
  }
}

export class FutureExecutor implements Executor<
  Future<Serializable>,
  FutureId<Serializable>,
  FutureExecutorContext
> {
  private database = new SimpleFutureDatabase();

  public createContext(): FutureExecutorContext {
    const methodMachine = createMethodMachine(this.database);
    const flushDatabase = methodMachine.methods.create(
      'flushDatabase',
      (futureMachine: FutureMachine) => {
        const { future, resolve } = futureMachine.withResolvers<void>();
        this.database.flush().then(() => resolve());
        return future;
      }
    );
    const createFuzzerFutureContext = methodMachine.methods.registerEntity(
      'FuzzerFutureContext',
      FutureExecutorContext,
      (stateBuilder: StateBuilder) => () => {
        const state = stateBuilder.build<FutureExecutorContextState>({
          flushDatabase,
          futureMachine: undefined,
          methodMachine,
        });
        return new FutureExecutorContext(state);
      }
    );
    return createFuzzerFutureContext();
  }
}
