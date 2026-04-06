import type {
  FutureDatabase,
  Serializable,
} from '../database/future_database.js';
import type {
  FutureExecutor,
  FutureId,
  RejectCallback,
  ResolveCallback,
} from './future.js';
import { FutureMachineImpl, type UnwrapFuture } from './future_machine_impl.js';

import type { Dictionary } from '../containers/dictionary.js';
import type {
  AnyEntityConstructor,
  EntityClass,
  StateBuilder,
} from '../containers/entity_impl.js';
import type { FutureSettledResult } from '../containers/future_settled_result.js';
import type { List } from '../containers/list.js';
import type { Struct } from '../containers/struct.js';
import type { AggregateException } from '../exceptions/aggregate_exception.js';
import type { Exception, ExceptionOptions } from '../exceptions/exception.js';
import { ExceptionBoundary } from '../exceptions/exception_boundary.js';
import type { SerializableException } from '../exceptions/serializable_exception.js';
import type { TypeException } from '../exceptions/type_exception.js';
import { GetFutureDatabase } from '../symbols.js';
import type { Future } from './future.js';
import type { ValidResult } from './future_impl.js';
import type { Method, MethodName } from './method.js';
import type { AnyMethodImpl } from './method_impl.js';

export type MethodMachine = Struct<{
  methods: Methods;
  containers: Containers;
  exceptions: Exceptions;
}>;

export function createMethodMachine(database: FutureDatabase): MethodMachine {
  const futureMachineImpl = new FutureMachineImpl(
    database[GetFutureDatabase]()
  );

  return futureMachineImpl.createStruct({
    methods: createMethods(futureMachineImpl),
    containers: createContainers(futureMachineImpl),
    exceptions: createExceptions(futureMachineImpl),
  });
}

export type Methods = Struct<{
  build: Method<() => FutureMachine>;
  create: Method<
    <Impl extends AnyMethodImpl>(name: MethodName, impl: Impl) => Method<Impl>
  >;
  registerEntity: Method<
    <
      E extends AnyEntityConstructor & EntityClass<E>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      C extends (...args: any[]) => InstanceType<E> & Serializable,
    >(
      name: string,
      entity: E,
      create: (stateBuilder: StateBuilder) => C
    ) => Method<C>
  >;
}>;

export function createMethods(futureMachineImpl: FutureMachineImpl): Methods {
  const futureMachine = createFutureMachine(futureMachineImpl);

  function checkBuiltState() {
    if (futureMachineImpl.built) {
      throw new Error('FutureMachine has already been built.');
    }
  }

  const build = futureMachineImpl.createInternalMethod(
    'buildFutureMachine',
    (): FutureMachine => {
      checkBuiltState();
      futureMachineImpl.built = true;
      return futureMachine;
    }
  );

  const create = futureMachineImpl.createInternalMethod(
    'createMethod',
    <Impl extends AnyMethodImpl>(
      name: MethodName,
      impl: Impl
    ): Method<Impl> => {
      checkBuiltState();
      return futureMachineImpl.createMethod(name, impl);
    }
  );

  const registerEntity = futureMachineImpl.createInternalMethod(
    'registerEntity',
    <
      E extends AnyEntityConstructor & EntityClass<E>,
      C extends (...args: unknown[]) => InstanceType<E> & Serializable,
    >(
      name: string,
      entity: E,
      create: (stateBuilder: StateBuilder) => C
    ): Method<C> => {
      checkBuiltState();
      return futureMachineImpl.registerEntity(name, entity, create);
    }
  );

  return futureMachineImpl.createStruct({
    build,
    create,
    registerEntity,
  });
}

export type FutureMachine = Struct<{
  create: Method<
    <T extends Serializable>(executor: FutureExecutor<T>) => Future<T>
  >;
  withResolvers: Method<
    <T extends Serializable>() => Struct<{
      future: Future<T>;
      id: FutureId<T>;
      resolve: ResolveCallback<T>;
      reject: RejectCallback;
    }>
  >;
  resolveFutureById: Method<
    <T extends Serializable>(
      futureId: FutureId<T>,
      ...result: T extends void ? [undefined?] : [ValidResult<T>]
    ) => void
  >;
  rejectFutureById: Method<
    <T extends Serializable>(
      futureId: FutureId<T>,
      reason?: Serializable
    ) => void
  >;
  resolve: Method<
    <T extends Serializable>(
      ...result: T extends void ? [undefined?] : [ValidResult<T>]
    ) => Future<T>
  >;
  reject: Method<
    <T extends Serializable = Serializable>(reason?: Serializable) => Future<T>
  >;
  try: Method<
    <Impl extends AnyMethodImpl>(
      method: Method<Impl>,
      ...args: Parameters<Impl>
    ) => Future<UnwrapFuture<ReturnType<Impl>>>
  >;
  race: Method<{
    <T extends readonly ValidResult<Serializable>[]>(
      values: T
    ): Future<UnwrapFuture<T[number]>>;
    <T extends ValidResult<Serializable>>(
      values: Iterable<T>
    ): Future<UnwrapFuture<T>>;
  }>;
  all: Method<{
    <T extends readonly ValidResult<Serializable>[]>(
      values: T
    ): Future<List<{ -readonly [I in keyof T]: UnwrapFuture<T[I]> }>>;
    <T extends ValidResult<Serializable>>(
      values: Iterable<T>
    ): Future<List<UnwrapFuture<T>[]>>;
  }>;
  any: Method<{
    <T extends readonly ValidResult<Serializable>[]>(
      values: T
    ): Future<UnwrapFuture<T[number]>>;
    <T extends ValidResult<Serializable>>(
      values: Iterable<T>
    ): Future<UnwrapFuture<T>>;
  }>;
  allSettled: Method<{
    <T extends readonly ValidResult<Serializable>[]>(
      values: T
    ): Future<
      List<{
        -readonly [I in keyof T]: FutureSettledResult<UnwrapFuture<T[I]>>;
      }>
    >;
    <T extends ValidResult<Serializable>>(
      values: Iterable<T>
    ): Future<List<FutureSettledResult<UnwrapFuture<T>>[]>>;
  }>;
}>;

function createFutureMachine(
  futureMachineImpl: FutureMachineImpl
): FutureMachine {
  const create = <T extends Serializable>(
    executor: FutureExecutor<T>
  ): Future<T> => {
    using _ = new ExceptionBoundary(create);
    return futureMachineImpl.createFuture(executor);
  };
  const createFutureMethod = futureMachineImpl.createInternalMethod(
    'createFuture',
    create
  );

  const withResolvers = futureMachineImpl.createInternalMethod(
    'withResolvers',
    <T extends Serializable>(): Struct<{
      future: Future<T>;
      id: FutureId<T>;
      resolve: ResolveCallback<T>;
      reject: RejectCallback;
    }> => {
      return futureMachineImpl.createFutureWithResolvers();
    }
  );

  const resolveFutureById = futureMachineImpl.createInternalMethod(
    'resolveFutureById',
    <T extends Serializable>(
      futureId: FutureId<T>,
      ...result: T extends void ? [undefined?] : [ValidResult<T>]
    ): void => {
      futureMachineImpl.resolveFutureById(
        futureId,
        result[0] as ValidResult<T>
      );
    }
  );

  const rejectFutureById = futureMachineImpl.createInternalMethod(
    'rejectFutureById',
    <T extends Serializable>(
      futureId: FutureId<T>,
      reason?: Serializable
    ): void => {
      futureMachineImpl.rejectFutureById(futureId, reason);
    }
  );

  const resolve = futureMachineImpl.createInternalMethod(
    'createResolve',
    <T extends Serializable>(
      ...result: T extends void ? [undefined?] : [ValidResult<T>]
    ): Future<T> => {
      return futureMachineImpl.resolve<T>(result[0] as ValidResult<T>);
    }
  );

  const reject = futureMachineImpl.createInternalMethod(
    'createReject',
    <T extends Serializable = Serializable>(
      reason?: Serializable
    ): Future<T> => {
      return futureMachineImpl.reject(reason);
    }
  );

  const try_ = <Impl extends (...args: unknown[]) => ValidResult<Serializable>>(
    method: Method<Impl>,
    ...args: Parameters<Impl>
  ): Future<UnwrapFuture<ReturnType<Impl>>> => {
    using _ = new ExceptionBoundary(try_);

    const { future, resolve, reject } =
      withResolvers<UnwrapFuture<ReturnType<Impl>>>();

    try {
      // TODO: Why do we need this type assertion?
      resolve(method(...args) as UnwrapFuture<ReturnType<Impl>>);
    } catch (e) {
      reject(futureMachineImpl.serializeThrownError(e));
    }

    return future;
  };

  const tryMethod = futureMachineImpl.createInternalMethod('try', try_);

  // LEFT OFF: All the exception tests are broken because the boundary logic
  // doesn't work anymore. Including the tests that don't fail.

  const race = <T extends ValidResult<Serializable>>(
    values: Iterable<T>
  ): Future<Serializable> => {
    using _ = new ExceptionBoundary(race);
    return futureMachineImpl.race<T>(values) as Future<Serializable>;
  };

  const raceMethod = futureMachineImpl.createInternalMethod<{
    <T extends readonly ValidResult<Serializable>[]>(
      values: T
    ): Future<UnwrapFuture<T[number]>>;
    <T extends ValidResult<Serializable>>(
      values: Iterable<T>
    ): Future<UnwrapFuture<T>>;
  }>('race', race);

  const all = <T extends ValidResult<Serializable>>(
    values: Iterable<T>
  ): Future<List<Serializable[]>> => {
    using _ = new ExceptionBoundary(all);
    return futureMachineImpl.all<T>(values) as Future<List<Serializable[]>>;
  };

  const allMethod = futureMachineImpl.createInternalMethod<{
    <T extends readonly ValidResult<Serializable>[]>(
      values: T
    ): Future<List<{ -readonly [I in keyof T]: UnwrapFuture<T[I]> }>>;
    <T extends ValidResult<Serializable>>(
      values: Iterable<T>
    ): Future<List<UnwrapFuture<T>[]>>;
  }>('all', all);

  const any = <T extends ValidResult<Serializable>>(
    values: Iterable<T>
  ): Future<Serializable> => {
    using _ = new ExceptionBoundary(any);
    return futureMachineImpl.any<T>(values) as Future<Serializable>;
  };

  const anyMethod = futureMachineImpl.createInternalMethod<{
    <T extends readonly ValidResult<Serializable>[]>(
      values: T
    ): Future<UnwrapFuture<T[number]>>;
    <T extends ValidResult<Serializable>>(
      values: Iterable<T>
    ): Future<UnwrapFuture<T>>;
  }>('any', any);

  const allSettled = <T extends ValidResult<Serializable>>(
    values: Iterable<T>
  ): Future<List<FutureSettledResult<Serializable>[]>> => {
    using _ = new ExceptionBoundary(allSettled);
    return futureMachineImpl.allSettled<T>(values) as Future<
      List<FutureSettledResult<Serializable>[]>
    >;
  };

  const allSettledMethod = futureMachineImpl.createInternalMethod<{
    <T extends readonly ValidResult<Serializable>[]>(
      values: T
    ): Future<
      List<{
        -readonly [I in keyof T]: FutureSettledResult<UnwrapFuture<T[I]>>;
      }>
    >;
    <T extends ValidResult<Serializable>>(
      values: Iterable<T>
    ): Future<List<FutureSettledResult<UnwrapFuture<T>>[]>>;
  }>('allSettled', allSettled);

  return futureMachineImpl.createStruct({
    create: createFutureMethod,
    withResolvers,
    resolveFutureById,
    rejectFutureById,
    resolve,
    reject,
    try: tryMethod,
    race: raceMethod,
    all: allMethod,
    any: anyMethod,
    allSettled: allSettledMethod,
  });
}

export type Containers = Struct<{
  createDictionary: Method<<T extends Serializable>() => Dictionary<T>>;
  createStruct: Method<
    <T extends Record<string, Serializable>>(obj: T) => Struct<T>
  >;
  createList: Method<<T extends Serializable[]>(...elements: T) => List<T>>;
}>;

function createContainers(futureMachineImpl: FutureMachineImpl): Containers {
  // TODO: Should take an iterable to construct the dictionary.
  const createDictionary = futureMachineImpl.createInternalMethod(
    'createDictionary',
    <T extends Serializable>(): Dictionary<T> => {
      return futureMachineImpl.createDictionary();
    }
  );

  const createStruct = futureMachineImpl.createInternalMethod(
    'createStruct',
    <T extends Record<string, Serializable>>(obj: T): Struct<T> => {
      return futureMachineImpl.createStruct(obj);
    }
  );

  // TODO: Should this take an array of elements instead? Or an Iterable?
  const createList = futureMachineImpl.createInternalMethod(
    'createList',
    <T extends Serializable[]>(...elements: T): List<T> => {
      return futureMachineImpl.createList(elements);
    }
  );
  return futureMachineImpl.createStruct({
    createDictionary,
    createStruct,
    createList,
  });
}

export type Exceptions = Struct<{
  createException: Method<
    (message?: string, options?: ExceptionOptions) => Exception
  >;
  createTypeException: Method<
    (message?: string, options?: ExceptionOptions) => TypeException
  >;
  createAggregateException: Method<
    (
      errors: List<Serializable[]>,
      message?: string,
      options?: ExceptionOptions
    ) => AggregateException
  >;
  createSerializableException: Method<
    (message?: string, options?: ExceptionOptions) => SerializableException
  >;
}>;

function createExceptions(futureMachineImpl: FutureMachineImpl): Exceptions {
  const createException = (
    message?: string,
    options?: ExceptionOptions
  ): Exception => {
    using _ = new ExceptionBoundary(createException);
    return futureMachineImpl.createException(message, options);
  };

  const createExceptionMethod = futureMachineImpl.createInternalMethod(
    'createException',
    createException
  );

  const createTypeException = (
    message?: string,
    options?: ExceptionOptions
  ): TypeException => {
    using _ = new ExceptionBoundary(createTypeException);
    return futureMachineImpl.createTypeException(message, options);
  };

  const createTypeExceptionMethod = futureMachineImpl.createInternalMethod(
    'createTypeException',
    createTypeException
  );

  const createAggregateException = (
    errors: List<Serializable[]>,
    message?: string,
    options?: ExceptionOptions
  ): AggregateException => {
    using _ = new ExceptionBoundary(createAggregateException);
    return futureMachineImpl.createAggregateException(errors, message, options);
  };

  const createAggregateExceptionMethod = futureMachineImpl.createInternalMethod(
    'createAggregateException',
    createAggregateException
  );

  const createSerializableException = (
    message?: string,
    options?: ExceptionOptions
  ): SerializableException => {
    using _ = new ExceptionBoundary(createSerializableException);
    return futureMachineImpl.createSerializableException(message, options);
  };

  const createSerializableExceptionMethod =
    futureMachineImpl.createInternalMethod(
      'createSerializableException',
      createSerializableException
    );

  return futureMachineImpl.createStruct({
    createException: createExceptionMethod,
    createTypeException: createTypeExceptionMethod,
    createAggregateException: createAggregateExceptionMethod,
    createSerializableException: createSerializableExceptionMethod,
  });
}
