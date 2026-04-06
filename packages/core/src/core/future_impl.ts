import { assert_unreached } from '../asserts.js';
import {
  FutureState,
  type FromSerializableDB,
  type FutureDB,
  type Serializable,
  type ToSerializableDB,
} from '../database/future_database.js';
import { deserialize } from '../database/serialize_utils.js';
import { FutureGetImpl, MethodGetImpl } from '../symbols.js';
import type { Future } from './future.js';
import {
  type FutureMachineImpl,
  type OnFinallyMethod,
  type OnFulfillMethod,
  type OnRejectMethod,
} from './future_machine_impl.js';
import type { Method } from './method.js';

export type ValidResult<T extends Serializable> =
  | T
  | Future<T>
  | PromiseLike<Future<T>>
  | PromiseLike<T>;

export type ResolveCallback<T extends Serializable> = Method<
  (result: ValidResult<T>) => void
>;
export type RejectCallback = Method<(reason?: Serializable) => void>;

export type FutureId<T extends Serializable> = string & {
  readonly __brand: unique symbol;
  readonly __type: T;
};

export type FutureExecutor<T extends Serializable> = (
  id: FutureId<T>,
  resolve: ResolveCallback<T>,
  reject: RejectCallback
) => void;

export enum ReactionType {
  Fulfill,
  Reject,
}

export class FutureImpl<T extends Serializable> {
  public constructor(
    private futureMachine: FutureMachineImpl,
    private futureDb: FutureDB<ToSerializableDB<T>>
  ) {}

  public getFutureDB(): FutureDB<ToSerializableDB<T>> {
    return this.futureDb;
  }

  private getState(): FutureState {
    return this.futureDb.getState();
  }

  private getResult(): T | undefined {
    return deserialize<T | undefined>(
      this.futureMachine,
      this.futureDb.getResult()
    );
  }

  private getReason(): Serializable | undefined {
    return deserialize(this.futureMachine, this.futureDb.getReason());
  }

  private getPromiseWithResolvers():
    | Partial<PromiseWithResolvers<T>>
    | undefined {
    return this.futureDb.getPromiseWithResolvers() as
      | Partial<PromiseWithResolvers<T>>
      | undefined;
  }

  private setPromiseWithResolvers(
    promiseWithResolvers: Partial<PromiseWithResolvers<T>> | undefined
  ): void {
    return this.futureDb.setPromiseWithResolvers(
      promiseWithResolvers as
        | Partial<PromiseWithResolvers<FromSerializableDB<ToSerializableDB<T>>>>
        | undefined
    );
  }

  // Handles the settled logic of the next functions.
  private settledNext<
    R1 extends Serializable = T,
    R2 extends Serializable = never,
  >(
    futureDb: FutureDB<ToSerializableDB<R1 | R2>>,
    onFulfilled?: OnFulfillMethod<T, R1>,
    onRejected?: OnRejectMethod<R2>
  ) {
    switch (this.getState()) {
      case FutureState.Fulfilled: {
        const onFulfilledImpl = onFulfilled
          ? onFulfilled[MethodGetImpl]()
          : undefined;
        this.futureMachine.queueFutureReactionJob(
          this.getResult()!,
          ReactionType.Fulfill,
          futureDb,
          onFulfilledImpl?.getMethodDb()
        );
        break;
      }
      case FutureState.Rejected: {
        const onRejectedImpl = onRejected
          ? onRejected[MethodGetImpl]()
          : undefined;
        this.futureMachine.queueFutureReactionJob(
          this.getReason()!,
          ReactionType.Reject,
          futureDb,
          onRejectedImpl?.getMethodDb()
        );
        break;
      }
      /* c8 ignore next 3 */
      // Stryker disable next-line all
      case FutureState.Pending:
        assert_unreached('settledNext called with a pending Future');
    }
  }

  // Special implementation of `next` for when another Future is resolved with
  // `this`.
  //
  // The goal is to call `this`'s `next` with the other Future's resolve and
  // reject as the `onFulfilled` and `onRejected` respectively. But since
  // there's no `Method` class for resolve and reject, there has to be special
  // handling.
  public nextWithFuture<U extends Serializable>(
    futureDb: FutureDB<ToSerializableDB<U>>
  ) {
    if (this.getState() === FutureState.Pending) {
      return this.futureMachine.addNextWithFuture(this.getFutureDB(), futureDb);
    }

    this.settledNext(futureDb);
  }

  public next<R1 extends Serializable = T, R2 extends Serializable = never>(
    onFulfilled?: OnFulfillMethod<T, R1>,
    onRejected?: OnRejectMethod<R2>
  ): Future<R1 | R2> {
    if (this.getState() === FutureState.Pending) {
      return this.futureMachine.addNext(
        this.getFutureDB(),
        onFulfilled,
        onRejected
      );
    }

    // TODO: This will write to the database but will be resolved (removed from
    // the database) before the program exits, so we don't need to store it.
    const { future } = this.futureMachine.createFutureWithResolvers<R1 | R2>();
    this.settledNext<R1, R2>(
      future[FutureGetImpl]().getFutureDB(),
      onFulfilled,
      onRejected
    );
    return future;
  }

  public finally(onFinally?: OnFinallyMethod): Future<T> {
    if (!onFinally) {
      return this.next();
    }
    // LEFT OFF: should we put the finally logic directly in here. And then call
    // next rather than addNext? We'd have to get access to the internal methods
    // here though
    return this.futureMachine.finally(this, onFinally);
  }

  public getPromise(): Promise<T> {
    if (!this.getPromiseWithResolvers()) {
      switch (this.getState()) {
        case FutureState.Fulfilled:
          this.setPromiseWithResolvers({
            promise: Promise.resolve(this.getResult()!),
          });
          break;
        case FutureState.Rejected:
          this.setPromiseWithResolvers({
            promise: Promise.reject(this.getReason()!),
          });
          break;
        case FutureState.Pending:
          this.setPromiseWithResolvers(Promise.withResolvers());
          break;
      }
    }

    return this.getPromiseWithResolvers()!.promise!;
  }
}
