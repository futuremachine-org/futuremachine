import type { Serializable } from '../database/future_database.js';
import type { SerializableObject } from '../database/serializable_object.js';
import {
  FutureCreate,
  FutureGetImpl,
  SerializableObjectBranding,
} from '../symbols.js';
import type { FutureImpl } from './future_impl.js';
import type {
  OnFinallyMethod,
  OnFulfillMethod,
  OnRejectMethod,
} from './future_machine_impl.js';

export type {
  FutureExecutor,
  FutureId,
  RejectCallback,
  ResolveCallback,
  ValidResult,
} from './future_impl.js';

export class Future<T extends Serializable> implements SerializableObject {
  public [SerializableObjectBranding] = undefined;

  private constructor(private impl: FutureImpl<T>) {}

  public static [FutureCreate]<T extends Serializable>(
    impl: FutureImpl<T>
  ): Future<T> {
    return new Future<T>(impl);
  }

  public [FutureGetImpl](): FutureImpl<T> {
    return this.impl;
  }

  // TODO: Rename since this conflicts with iterator's `next` method.
  public next<R1 extends Serializable = T, R2 extends Serializable = never>(
    onFulfilled?: OnFulfillMethod<T, R1>,
    onRejected?: OnRejectMethod<R2>
  ): Future<R1 | R2> {
    return this.impl.next(onFulfilled, onRejected);
  }

  public catch<R extends Serializable>(
    onRejected?: OnRejectMethod<R>
  ): Future<R> {
    return this.impl.next(undefined, onRejected);
  }

  public finally(onFinally?: OnFinallyMethod): Future<T> {
    return this.impl.finally(onFinally);
  }

  public getPromise(): Promise<T> {
    return this.impl.getPromise();
  }
}
