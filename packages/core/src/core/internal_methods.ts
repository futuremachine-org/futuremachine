import type { StateBuilder } from '../containers/entity_impl.js';
import { type FutureSettledResult } from '../containers/future_settled_result.js';
import type { List } from '../containers/list.js';
import type { RawStruct } from '../containers/struct.js';
import type {
  AggregateDB,
  Serializable,
  SerializableDB,
  ToSerializableDB,
} from '../database/future_database.js';
import { serialize } from '../database/serialize_utils.js';
import { AggregateException } from '../exceptions/aggregate_exception.js';
import { Exception, type ExceptionOptions } from '../exceptions/exception.js';
import { SerializableException } from '../exceptions/serializable_exception.js';
import { TypeException } from '../exceptions/type_exception.js';
import type { Future } from './future.js';
import type { FutureId, ValidResult } from './future_impl.js';
import type { FutureMachineImpl } from './future_machine_impl.js';
import type { Method } from './method.js';

export function importInternalMethods(futureMachineImpl: FutureMachineImpl) {
  const resolve = futureMachineImpl.createInternalMethod(
    'resolve',
    // TODO: We shouldn't bind a string for the future id. We'll want to know in
    // the future if a Future id is bound to a method. So we should use a
    // special class for it.
    <T extends Serializable>(futureId: FutureId<T>, result: ValidResult<T>) => {
      futureMachineImpl.resolveFutureById<T>(futureId, result);
    }
  );
  const reject = futureMachineImpl.createInternalMethod(
    'reject',
    <T extends Serializable>(futureId: FutureId<T>, reason: Serializable) => {
      futureMachineImpl.rejectFutureById(futureId, reason);
    }
  );
  const thunk = futureMachineImpl.createInternalMethod(
    'thunk',
    <T>(value: T): T => {
      return value;
    }
  );

  const thrower = futureMachineImpl.createInternalMethod(
    'thrower',
    (value: unknown) => {
      throw value;
    }
  );
  const nextFinally = futureMachineImpl.createInternalMethod(
    'nextFinally',
    <T extends Serializable>(
      onFinally: Method<() => ValidResult<Serializable>>,
      value: T
    ): Future<T> => {
      const result = onFinally();
      const future = futureMachineImpl.resolve(result);
      return future.next(thunk.bindArgs(value)) as Future<T>;
    }
  );
  const catchFinally = futureMachineImpl.createInternalMethod(
    'catchFinally',
    <T extends Serializable>(
      onFinally: Method<() => ValidResult<Serializable>>,
      value: T
    ): Future<T> => {
      const result = onFinally();
      const future = futureMachineImpl.resolve(result);
      return future.next(thrower.bindArgs(value));
    }
  );
  const allResolveElement = futureMachineImpl.createInternalMethod(
    'allResolveElement',
    <T extends Serializable, U extends T>(
      futureAllId: FutureId<List<T[]>>,
      futureAllDb: AggregateDB<ToSerializableDB<T>>,
      index: number,
      result: U
    ) => {
      // TODO: The spec has something about checking if this has already been
      // called. I can't imagine a situation in which it could be called twice.
      // Only thing I could imagine is that a PromiseLike implementation does
      // something weird.
      const values = futureAllDb.settleElement(index, serialize(result));
      if (values !== undefined) {
        futureMachineImpl.resolveFutureById(
          futureAllId,
          futureMachineImpl.getListFromListDB(values)
        );
      }
    }
  );
  const anyRejectElement = futureMachineImpl.createInternalMethod(
    'anyRejectElement',
    <T extends Serializable>(
      futureAnyId: FutureId<T>,
      futureAnyDb: AggregateDB<SerializableDB>,
      index: number,
      reason: Serializable
    ) => {
      const errors = futureAnyDb.settleElement(index, serialize(reason));
      if (errors !== undefined) {
        const exception = futureMachineImpl.createAggregateException(
          futureMachineImpl.getListFromListDB(errors),
          'All futures were rejected'
        );
        futureMachineImpl.rejectFutureById(futureAnyId, exception);
      }
    }
  );

  function createFutureSettledResult(
    status: 'fulfilled' | 'rejected',
    value: Serializable
  ) {
    if (status === 'fulfilled') {
      return futureMachineImpl.createStruct<
        RawStruct<FutureSettledResult<Serializable>>
      >({
        status,
        value,
      });
    } else {
      return futureMachineImpl.createStruct<
        RawStruct<FutureSettledResult<Serializable>>
      >({
        status,
        reason: value,
      });
    }
  }

  const allSettledResolveElement = futureMachineImpl.createInternalMethod(
    'allSettledResolveElement',
    <T extends Serializable, U extends T>(
      futureAllId: FutureId<List<T[]>>,
      futureAllDb: AggregateDB<ToSerializableDB<FutureSettledResult<T>>>,
      index: number,
      result: U
    ) => {
      const futureSettledResult = createFutureSettledResult(
        'fulfilled',
        result
      );
      const values = futureAllDb.settleElement(
        index,
        serialize(futureSettledResult)
      );
      if (values !== undefined) {
        futureMachineImpl.resolveFutureById(
          futureAllId,
          futureMachineImpl.getListFromListDB(values)
        );
      }
    }
  );
  const allSettledRejectElement = futureMachineImpl.createInternalMethod(
    'allSettledRejectElement',
    <T extends Serializable>(
      futureAllId: FutureId<List<T[]>>,
      futureAllDb: AggregateDB<ToSerializableDB<FutureSettledResult<T>>>,
      index: number,
      reason: Serializable
    ) => {
      const futureSettledResult = createFutureSettledResult('rejected', reason);
      const values = futureAllDb.settleElement(
        index,
        serialize(futureSettledResult)
      );
      if (values !== undefined) {
        futureMachineImpl.resolveFutureById(
          futureAllId,
          futureMachineImpl.getListFromListDB(values)
        );
      }
    }
  );

  const createException = futureMachineImpl.registerInternalEntity(
    'Exception',
    Exception,
    (stateBuilder: StateBuilder) =>
      (message?: string, options?: ExceptionOptions) => {
        return new Exception(
          stateBuilder.build(Exception.createExceptionState(message, options))
        );
      }
  );

  const createTypeException = futureMachineImpl.registerInternalEntity(
    'TypeException',
    TypeException,
    (stateBuilder: StateBuilder) =>
      (message?: string, options?: ExceptionOptions) => {
        return new TypeException(
          stateBuilder.build(
            TypeException.createTypeExceptionState(message, options)
          )
        );
      }
  );

  const createAggregateException = futureMachineImpl.registerInternalEntity(
    'AggregateException',
    AggregateException,
    (stateBuilder: StateBuilder) =>
      (
        errors: List<Serializable[]>,
        message?: string,
        options?: ExceptionOptions
      ) => {
        return new AggregateException(
          stateBuilder.build(
            AggregateException.createAggregateExceptionState(
              errors,
              message,
              options
            )
          )
        );
      }
  );

  const createSerializableException = futureMachineImpl.registerInternalEntity(
    'SerializableException',
    SerializableException,
    (stateBuilder: StateBuilder) =>
      (message?: string, options?: ExceptionOptions) => {
        return new SerializableException(
          stateBuilder.build(
            SerializableException.createSerializableExceptionState(
              message,
              options
            )
          )
        );
      }
  );

  return {
    resolve,
    reject,
    thunk,
    thrower,
    nextFinally,
    catchFinally,
    allResolveElement,
    anyRejectElement,
    allSettledResolveElement,
    allSettledRejectElement,
    createException,
    createTypeException,
    createAggregateException,
    createSerializableException,
  };
}

export type InternalMethods = ReturnType<typeof importInternalMethods>;
