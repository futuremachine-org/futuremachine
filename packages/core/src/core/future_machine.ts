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

/**
 * The API of the `@futuremachine/core` library.
 *
 * Created by the {@link createFutureMachine | createFutureMachine()}. Each
 * instance is backed by a {@link FutureDatabase}.
 * @category API
 */
export type FutureMachineAPI = Struct<{
  /**
   *  Contains methods to create {@link Method}s, register {@link Entity}s, and
   *  build the {@link FuturesAPI}.
   */
  methods: MethodsAPI;

  /**
   * Contains APIs to create {@link Dictionary}s, {@link Struct}s, and
   * {@link List}s.
   */
  containers: ContainersAPI;

  /**
   * Contains methods to create {@link Exception}s.
   */
  exceptions: ExceptionsAPI;
}>;

/**
 * The primary entry point for the `@futuremachine/core` library.
 *
 * This function initializes a FutureMachine engine backed by `database` and
 * returns its API.
 * @param database - The database instance used to read, persist, and sync the
 * FutureMachine state.
 * @returns The {@link FutureMachineAPI} backed by `database`.
 * @example
 * ```ts
 * const db = new SQLFutureDatabase('test.db');
 *
 * const { methods, containers, exceptions } = createFutureMachine(db);
 * ```
 * @category API
 */
export function createFutureMachine(
  database: FutureDatabase
): FutureMachineAPI {
  const futureMachineImpl = new FutureMachineImpl(
    database[GetFutureDatabase]()
  );

  return futureMachineImpl.createStruct({
    methods: createMethodsAPI(futureMachineImpl),
    containers: createContainersAPI(futureMachineImpl),
    exceptions: createExceptionsAPI(futureMachineImpl),
  });
}

// TODO: I think it would make more sense if this was like the RegistrationAPI
// or BuilderAPI. And you had registerMethod and registerEntity. But I dislike
// the length of those function names, and I like how `method.create` looks.

/**
 * The API for building the FutureMachine.
 *
 *
 * **All {@link Method}s must be created and {@link Entity}s must be registered
 * at the beginning of every session before {@link build | build()} is called.**
 *
 * @category API
 */
export type MethodsAPI = Struct<{
  /**
   * Builds the FutureMachine and returns its {@link FuturesAPI}.
   *
   * **No methods can be created or entities registered after this is called.**
   */
  build: Method<() => FuturesAPI>;

  /**
   * Creates a {@link Method}.
   *
   * **Can only be called before {@link build | build()} is called**
   *
   * @param name - A unique identifier, only used for the FutureMachine to
   * serialize and deserialize the method to the database.
   *
   * **Must be registered with the same name for each session.** When a
   * {@link Method} is deserialized and it hasn't been created for this session,
   * the {@link Method} it is bound to will throw an {@link Exception} when
   * called.
   * @param impl - The implementation of the Method.
   *
   * Arguments can be of any type, but the return type must be a
   * {@link Serializable}.
   * @returns A {@link Method} which is a thin wrapper of `impl`.
   * @example
   * ```ts
   * const { methods } = createFutureMachine(db);
   *
   * const method = methods.create("MyMethod", (name: string) => {
   *   console.log(`Hello ${name}`);
   * });
   * ```
   */
  create: Method<
    <Impl extends AnyMethodImpl>(name: MethodName, impl: Impl) => Method<Impl>
  >;

  /**
   * Registers an {@link Entity}.
   *
   * **Can only be called before {@link build | build()} is called**
   *
   * @param name - A unique identifier, only used for the FutureMachine to
   * serialize and deserialize the entity to the database.
   *
   * **Must be registered with the same name for each session.** When a
   * {@link Entity} is deserialized and it hasn't been created for this session,
   * the {@link Method} it is bound to will throw an {@link Exception} when
   * called.
   * @param entity - A class that extends {@link Entity}.
   *
   * Once registered, it's a {@link Serializable}.
   * @param create - A callback that returns the implementation of `entity`'s
   * constructor. The constructor must build a {@link State} using the
   * {@link StateBuilder} and must return an instance of the `entity`
   * constructed with that {@link State}.
   * @returns Returns a {@link Method}, the constructor of `entity`.
   * @example
   * ```ts
   * const { methods } = createFutureMachine(db);
   *
   * type stateType = {
   *   name: string;
   *   count: number | undefined;
   * };
   *
   * class MyClass extends Entity<stateType> {
   *   getName() {
   *     return this.get("name");
   *   }
   *   setCount(value: number | undefined) {
   *     this.set("count", value);
   *   }
   *   getCount() {
   *     return this.get("count");
   *   }
   * }
   *
   * const createMyClass = methods.registerEntity(
   *   'MyClass',
   *   MyClass,
   *   (stateBuilder: StateBuilder) => (name: string) => {
   *     return new MyClass(
   *       stateBuilder.build({
   *         name,
   *         count: undefined,
   *       })
   *     );
   *   }
   * );
   *
   * ```
   */
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

function createMethodsAPI(futureMachineImpl: FutureMachineImpl): MethodsAPI {
  const futureMachine = createFuturesAPI(futureMachineImpl);

  function checkBuiltState() {
    if (futureMachineImpl.built) {
      throw new Error('FutureMachine has already been built.');
    }
  }

  const build = futureMachineImpl.createInternalMethod(
    'buildFutureMachine',
    (): FuturesAPI => {
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

/**
 * The API for {@link Future}s.
 *
 * The {@link Serializable} equivalent of a vanilla JavaScript `Promise`.
 *
 * @category API
 */
export type FuturesAPI = Struct<{
  /**
   * Creates a {@link Future}.
   *
   * @param executor - A callback that receives the {@link Future}'s
   * {@link FutureId}, {@link ResolveCallback}, and {@link RejectCallback}.
   * @returns A {@link Future}.
   * @example
   * ```ts
   * const { methods } = createFutureMachine(futureDatabase);
   * const futures = methods.build();
   *
   * // Sends an email and returns a Future that resolves with its response.
   * function sendEmail(
   *   to: string,
   *   subject: string,
   *   body: string
   * ): Future<string> {
   *   return futures.create<string>((id, _resolve, _reject) => {
   *     emailService.send({
   *       to,
   *       subject,
   *       body,
   *       metadata: JSON.stringify({ id }),
   *     });
   *   });
   * }
   *
   * // Email may be received on another session.
   * emailService.onEmail((response: string, metadata: string) => {
   *   const futureId = JSON.parse(metadata).id as FutureId<string>;
   *   futures.resolveFutureById(futureId, response);
   * });
   * ```
   */
  create: Method<
    <T extends Serializable>(executor: FutureExecutor<T>) => Future<T>
  >;
  /**
   * Creates a {@link Future} and returns it, its {@link ResolveCallback}, its
   * {@link RejectCallback}, and its {@link FutureId}.
   *
   * @returns A {@link Future}, its {@link ResolveCallback}, its
   * {@link RejectCallback}, and its {@link FutureId}.
   * @example
   * ```ts
   * const { methods } = createFutureMachine(futureDatabase);
   * const futures = methods.build();
   *
   * // Sends an email and returns a Future that resolves with its response.
   * function sendEmail(
   *   to: string,
   *   subject: string,
   *   body: string
   * ): Future<string> {
   *   const { future, id } = futures.withResolvers();
   *   emailService.send({
   *     to,
   *     subject,
   *     body,
   *     metadata: JSON.stringify({ id }),
   *   });
   *   return future;
   * }
   *
   * // Email may be received on another session.
   * emailService.onEmail((response: string, metadata: string) => {
   *   const futureId = JSON.parse(metadata).id as FutureId<string>;
   *   futures.resolveFutureById(futureId, response);
   * });
   * ```
   */
  withResolvers: Method<
    <T extends Serializable>() => Struct<{
      future: Future<T>;
      id: FutureId<T>;
      resolve: ResolveCallback<T>;
      reject: RejectCallback;
    }>
  >;
  /**
   * Resolves a {@link Future} using its {@link FutureId}.
   *
   * @param futureId - The {@link FutureId} of the {@link Future} to resolve.
   * @param result - The value to resolve the {@link Future} with.
   * @example
   * ```ts
   * const { methods } = createFutureMachine(futureDatabase);
   * const futures = methods.build();
   *
   * // Email may be received on another session.
   * emailService.onEmail((response: string, metadata: string) => {
   *   const futureId = JSON.parse(metadata).id as FutureId<string>;
   *   futures.resolveFutureById(futureId, response);
   * });
   *
   * // Sends an email and returns a Future that resolves with its response.
   * function sendEmail(
   *   to: string,
   *   subject: string,
   *   body: string
   * ): Future<string> {
   *   const { future, id } = futures.withResolvers();
   *   emailService.send({
   *     to,
   *     subject,
   *     body,
   *     metadata: JSON.stringify({ id }),
   *   });
   *   return future;
   * }
   * ```
   */
  resolveFutureById: Method<
    <T extends Serializable>(
      futureId: FutureId<T>,
      ...result: T extends void ? [undefined?] : [ValidResult<T>]
    ) => void
  >;
  /**
   * Rejects a {@link Future} using its {@link FutureId}.
   *
   * @param futureId - The {@link FutureId} of the {@link Future} to reject.
   * @param reason - The value to reject the {@link Future} with.
   * @example
   * ```ts
   * const { methods } = createFutureMachine(futureDatabase);
   * const futures = methods.build();
   *
   * // Email may be received on another session.
   * emailService.onEmailDropped((metadata: string) => {
   *   const futureId = JSON.parse(metadata).id as FutureId<string>;
   *   futures.rejectFutureById(futureId, exceptions.createException('Email dropped.'));
   * });
   *
   * // Sends an email and returns a Future that resolves with its response.
   * function sendEmail(
   *   to: string,
   *   subject: string,
   *   body: string
   * ): Future<string> {
   *   const { future, id } = futures.withResolvers();
   *   emailService.send({
   *     to,
   *     subject,
   *     body,
   *     metadata: JSON.stringify({ id }),
   *   });
   *   return future;
   * }
   * ```
   */
  rejectFutureById: Method<
    <T extends Serializable>(
      futureId: FutureId<T>,
      reason?: Serializable
    ) => void
  >;
  /**
   * Creates a {@link Future} resolved with `result`.
   *
   * @param result - The value to resolve the {@link Future} with.
   * @returns A {@link Future} resolved with `result`.
   * @example
   * ```ts
   * const { methods } = createFutureMachine(futureDatabase);
   * const futures = methods.build();
   *
   * const future: Future<string> = futures.resolve("Hello");
   * ```
   */
  resolve: Method<
    <T extends Serializable>(
      ...result: T extends void ? [undefined?] : [ValidResult<T>]
    ) => Future<T>
  >;
  /**
   * Creates a {@link Future} rejected with `reason`.
   *
   * @param reason - The value to reject the {@link Future} with.
   * @returns A {@link Future} rejected with `reason`.
   * @example
   * ```ts
   * const { methods, exceptions } = createFutureMachine(futureDatabase);
   * const futures = methods.build();
   *
   * const future: Future<string> = futures.reject<string>(
   *   exceptions.createException('MyError')
   * );
   * ```
   */
  reject: Method<
    <T extends Serializable = Serializable>(reason?: Serializable) => Future<T>
  >;
  /**
   * Creates a {@link Future} that's resolved with `method`'s return value or
   * rejected with the value it throws.
   *
   * @param method - The {@link Method} which either resolves or rejects the
   * {@link Future}.
   * @param args - The arguments to pass to {@link Method}.
   * @returns A {@link Future} either resolved with the value returned by
   * `method` or rejected with the value thrown by `method`.
   * @example
   * ```ts
   * const { methods, exceptions } = createFutureMachine(futureDatabase);
   *
   * const divideMethod = methods.create(
   *   'divideMethod',
   *   (numerator: number, denominator: number) => {
   *     if (denominator === 0) {
   *       throw exceptions.createException('Divide by zero');
   *     }
   *     return numerator / denominator;
   *   }
   * );
   *
   * const futures = methods.build();
   *
   * const resolvedFuture = futures.try(divideMethod, 10, 5);
   * const rejectedFuture = futures.try(divideMethod, 7, 0);
   * ```
   */
  try: Method<
    <Impl extends AnyMethodImpl>(
      // TODO: This should accept plain callbacks as well.
      method: Method<Impl>,
      ...args: Parameters<Impl>
    ) => Future<UnwrapFuture<ReturnType<Impl>>>
  >;
  /**
   * Creates a {@link Future} that settles when the first {@link Future} in
   * `values` settles.
   *
   * @param values - An iterable of {@link Serializable}s.
   * @returns A {@link Future} which settles with the same outcome as the first
   * settled value in `values`.
   *
   * The returned {@link Future} will either be:
   * * Pending if all values in `values` are unsettled {@link Future}s
   * * Otherwise, settled with the first non-{@link Future} {@link Serializable}
   *   or settled {@link Future}.
   * @example
   * ```ts
   * const { methods } = createFutureMachine(futureDatabase);
   * const futures = methods.build();
   *
   * const { future: f1, resolve: r1 } = futures.withResolvers<string>();
   * const { future: f2, resolve: r2 } = futures.withResolvers<number>();
   *
   * const raceFuture: Future<string | number> = futures.race([f1, f2]);
   *
   * r2(4312);
   * r1('Hello');
   * // raceFuture will be resolved with 4312.
   * ```
   */
  race: Method<{
    <T extends readonly ValidResult<Serializable>[]>(
      values: T
    ): Future<UnwrapFuture<T[number]>>;
    <T extends ValidResult<Serializable>>(
      values: Iterable<T>
    ): Future<UnwrapFuture<T>>;
  }>;
  /**
   * Creates a {@link Future} that resolves when all `values` are resolved, or
   * rejects as soon as any {@link Future} in `values` rejects.
   *
   * @param values - An iterable of {@link Serializable}s.
   * @returns A {@link Future} which resolves with a {@link List} of the results
   * of `values` or rejects with the first {@link Future} in `values` to reject.
   * @example
   * ```ts
   * const { methods } = createFutureMachine(futureDatabase);
   * const futures = methods.build();
   *
   * const { future: f1, resolve: r1 } = futures.withResolvers<string>();
   * const { future: f2, resolve: r2 } = futures.withResolvers<number>();
   *
   * const allFuture: Future<List<[string, number]>> = futures.all([f1, f2]);
   *
   * r2(1234);
   * r1('Hello');
   * // allFuture resolves with List<['Hello', 1234]>.
   * ```
   */
  all: Method<{
    <T extends readonly ValidResult<Serializable>[]>(
      values: T
    ): Future<List<{ -readonly [I in keyof T]: UnwrapFuture<T[I]> }>>;
    <T extends ValidResult<Serializable>>(
      values: Iterable<T>
    ): Future<List<UnwrapFuture<T>[]>>;
  }>;
  /**
   * Creates a {@link Future} that resolves with the first successfully resolved
   * value.
   *
   * @param values - An iterable of {@link Serializable}s.
   * @returns A {@link Future} that resolves when any value in `values` is
   * resolved or rejects with an {@link AggregateException} when all `values`
   * are rejected.
   * @example
   * ```ts
   * const { methods } = createFutureMachine(futureDatabase);
   * const futures = methods.build();
   *
   * const { future: f1, reject: reject1 } = futures.withResolvers<string>();
   * const { future: f2, resolve: resolve2 } =
   *   futures.withResolvers<number>();
   *
   * const anyFuture: Future<string | number> = futures.any([f1, f2]);
   *
   * reject1('Hello');
   * resolve2(4312);
   * // anyFuture is resolved with 4312.
   * ```
   */
  any: Method<{
    <T extends readonly ValidResult<Serializable>[]>(
      values: T
    ): Future<UnwrapFuture<T[number]>>;
    <T extends ValidResult<Serializable>>(
      values: Iterable<T>
    ): Future<UnwrapFuture<T>>;
  }>;
  /**
   * Creates a {@link Future} that resolves when all `values` are settled.
   *
   * @param values - An iterable of {@link Serializable}s.
   * @returns A {@link Future} that resolves to a {@link List} of
   * {@link FutureSettledResult}s containing the resolution information of each
   * value in `values`.
   * @example
   * ```ts
   * const { methods } = createFutureMachine(futureDatabase);
   * const futures = methods.build();
   *
   * const { future: f1, resolve: resolve1 } =
   *   futures.withResolvers<string>();
   * const { future: f2, reject: reject2 } = futures.withResolvers<number>();
   *
   * const allSettledFuture: Future<
   *   List<[FutureSettledResult<string>, FutureSettledResult<number>]>
   * > = futures.allSettled([f1, f2]);
   *
   * reject2(1234);
   * resolve1('Hello');
   * // `allSettledFuture` is resolved with a List containing
   * // FutureSettledResults with these values:
   * // * [0]: { status: 'fulfilled', value: 'Hello' }
   * // * [1]: { status: 'rejected', reason: 1234 }
   * ```
   */
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

function createFuturesAPI(futureMachineImpl: FutureMachineImpl): FuturesAPI {
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

/**
 * The API for {@link Dictionary}s.
 *
 * The {@link Serializable} equivalent of a vanilla JavaScript `Map`.
 *
 * @category API
 */
export type DictionariesAPI = Struct<{
  /**
   * Creates a {@link Dictionary}.
   *
   * @param iterable - An iterable that yields `[key, value]` entries which will
   * be used to create the initial state of the {@link Dictionary}. **`key`s
   * must be strings and `value`s must be {@link Serializable}.**
   *
   * If not provided, the Dictionary is constructed with no entries.
   * @returns A {@link Dictionary}.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(db);
   *
   * const dictionary = containers.dictionary.create<number>([
   *   ['hello', 1],
   *   ['world', 2],
   * ]);
   * ```
   */
  create: Method<
    <T extends Serializable>(
      iterable?: Iterable<readonly [string, T]> | null
    ) => Dictionary<T>
  >;
  /**
   * Creates a {@link Dictionary} by grouping `items` according to the keys
   * returned by `callback`.
   *
   * @param items - An iterable that yields the values that will be grouped by
   * `callback`.
   *
   * **Can only contain {@link Serializable} values**
   *
   * @param callback - Called for each item of `items`, returns the group the
   * item belongs to.
   * @returns A {@link Dictionary} containing the groups.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(db);
   *
   * const items: number[] = [0,1,2,3,4,5,6,7,8,9];
   *
   * const groups = containers.dictionary.groupBy(items, (item) => {
   *   return item % 2 === 0 ? 'even' : 'odd';
   * });
   * // groups is a Dictionary containing List components:
   * // 'even' -> List([0, 2, 4, 6, 8])
   * // 'odd'  -> List([1, 3, 5, 7, 9])
   * ```
   */
  groupBy: Method<
    <T extends Serializable>(
      items: Iterable<T>,
      callback:
        | ((item: T, index: number) => string)
        | Method<(item: T, index: number) => string>
    ) => Dictionary<List<T[]>>
  >;
}>;

/**
 * The API for {@link Struct}s.
 *
 * The {@link Serializable} equivalent of a vanilla JavaScript `Object`.
 *
 * @category API
 */
export type StructsAPI = Struct<{
  /**
   * Creates a {@link Struct}.
   *
   * @param obj - The plain JavaScript object used to populate the initial
   * {@link Struct} state.
   *
   * **All property values must be {@link Serializable}.**
   * @returns A {@link Struct}.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(db);
   *
   * containers.struct.create({ str: 'Hello', num: 10 });
   * ```
   */
  create: Method<<T extends Record<string, Serializable>>(obj: T) => Struct<T>>;
}>;

/**
 * The API for {@link List}s.
 *
 * The {@link Serializable} equivalent of a vanilla JavaScript `Array`.
 *
 * @category API
 */
export type ListsAPI = Struct<{
  /**
   * Creates a {@link List}.
   *
   * @param elements - The initial values the returns {@link List} will contain.
   *
   * **All values must be {@link Serializable}.**
   * @returns A {@link List}.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(db);
   *
   * containers.list.create(0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
   * ```
   */
  create: Method<<T extends Serializable[]>(...elements: T) => List<T>>;
}>;

/**
 * APIs to create {@link Serializable} containers: {@link Dictionary}s,
 * {@link Struct}s, and {@link List}s.
 *
 * Replacements for their non-{@link Serializable} vanilla JavaScript
 * equivalent: Maps, Objects, and Arrays.
 * @category API
 */
export type ContainersAPI = Struct<{
  /**
   * The API for {@link Dictionary}s.
   */
  dictionary: DictionariesAPI;
  /**
   * The API for {@link Struct}s.
   */
  struct: StructsAPI;
  /**
   * The API for {@link List}s.
   */
  list: ListsAPI;
}>;

function createContainersAPI(
  futureMachineImpl: FutureMachineImpl
): ContainersAPI {
  // TODO: Should take an iterable to construct the dictionary.
  const dictionaryCreate = futureMachineImpl.createInternalMethod(
    'dictionaryCreate',
    <T extends Serializable>(
      iterable?: Iterable<readonly [string, T]> | null
    ): Dictionary<T> => {
      return futureMachineImpl.createDictionary(iterable);
    }
  );

  const dictionaryGroupBy = futureMachineImpl.createInternalMethod(
    'dictionaryGroupBy',
    <T extends Serializable>(
      items: Iterable<T>,
      callback:
        | ((item: T, index: number) => string)
        | Method<(item: T, index: number) => string>
    ): Dictionary<List<T[]>> => {
      return futureMachineImpl.dictionaryGroupBy(items, callback);
    }
  );

  const structCreate = futureMachineImpl.createInternalMethod(
    'createStruct',
    <T extends Record<string, Serializable>>(obj: T): Struct<T> => {
      return futureMachineImpl.createStruct(obj);
    }
  );

  // TODO: Should this take an array of elements instead? Or an Iterable?
  const listCreate = futureMachineImpl.createInternalMethod(
    'listCreate',
    <T extends Serializable[]>(...elements: T): List<T> => {
      return futureMachineImpl.createList(elements);
    }
  );
  return futureMachineImpl.createStruct({
    dictionary: futureMachineImpl.createStruct({
      create: dictionaryCreate,
      groupBy: dictionaryGroupBy,
    }),
    struct: futureMachineImpl.createStruct({
      create: structCreate,
    }),
    list: futureMachineImpl.createStruct({
      create: listCreate,
    }),
  });
}

/**
 * The API for {@link Exception}s.
 *
 * The {@link Serializable} equivalent of a vanilla JavaScript `Error`.
 *
 * @category API
 */
export type ExceptionsAPI = Struct<{
  /**
   * Creates an {@link Exception}.
   *
   * @param message - The {@link Exception}'s message.
   * @param options - Options to construct the {@link Exception}. Only contains
   * `cause` which specifies the cause of the {@link Exception}.
   * @returns An {@link Exception}.
   * @example
   * ```ts
   * const { exceptions } = createFutureMachine(futureDatabase);
   * const exception: Exception = exceptions.createException('MyError', {
   *   cause: 'Original Exception message',
   * });
   * ```
   */
  createException: Method<
    (message?: string, options?: ExceptionOptions) => Exception
  >;
  /**
   * Creates a {@link TypeException}. An exception thrown for unexpected types.
   *
   * @param message - The {@link TypeException}'s message.
   * @param options - Options to construct the {@link TypeException}. Only
   * contains `cause` which specifies the cause of the {@link TypeException}.
   * @returns A {@link TypeException}.
   * @example
   * ```ts
   * const { exceptions } = createFutureMachine(futureDatabase);
   * const exception: TypeException = exceptions.createTypeException('MyError', {
   *   cause: 'Original Exception message',
   * });
   * ```
   */
  createTypeException: Method<
    (message?: string, options?: ExceptionOptions) => TypeException
  >;
  /**
   * Creates an {@link AggregateException}. Thrown to aggregate multiple
   * exceptions as one. E.g. when all of the
   * {@link FuturesAPI.any | FuturesAPI.any()} {@link Future} reject.
   *
   * @param errors - A {@link List} containing the collection of exceptions to
   * aggregate.
   * @param message - The {@link AggregateException}'s message.
   * @param options - Options to construct the {@link AggregateException}. Only
   * contains `cause` which specifies the cause of the
   * {@link AggregateException}.
   * @returns An {@link AggregateException}.
   * @example
   * ```ts
   * const { exceptions, containers } = createFutureMachine(futureDatabase);
   * const error1 = exceptions.createException('First failure');
   * const error2 = exceptions.createException('Second failure');
   * const errorList = containers.list.create(error1, error2);
   * const exception: AggregateException = exceptions.createAggregateException(
   *   errorList,
   *   'Multiple operations failed'
   * );
   * ```
   */
  createAggregateException: Method<
    (
      errors: List<Serializable[]>,
      message?: string,
      options?: ExceptionOptions
    ) => AggregateException
  >;
  /**
   * Creates a {@link SerializableException}. An exception thrown when a value
   * cannot be serialized. E.g. when a Method throws a non-{@link Serializable}
   * type.
   *
   * @param message - The {@link SerializableException}'s message.
   * @param options - Options to construct the {@link SerializableException}.
   * Only contains `cause` which specifies the cause of the
   * {@link SerializableException}.
   * @returns A {@link SerializableException}.
   * @example
   * ```ts
   * const { exceptions } = createFutureMachine(futureDatabase);
   * const exception: SerializableException =
   *   exceptions.createSerializableException('MyError', {
   *     cause: 'Original Exception message',
   *   });
   * ```
   */
  createSerializableException: Method<
    (message?: string, options?: ExceptionOptions) => SerializableException
  >;
}>;

function createExceptionsAPI(
  futureMachineImpl: FutureMachineImpl
): ExceptionsAPI {
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
