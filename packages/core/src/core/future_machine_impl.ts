import {
  type DictionaryDB,
  type EntityDB,
  type FromSerializableDB,
  FutureDatabaseImpl,
  type FutureDB,
  FutureState,
  type ListDB,
  type MethodDB,
  MethodType,
  type Reaction,
  type Serializable,
  type SerializableDB,
  type StructDB,
  type ToSerializableDB,
} from '../database/future_database.js';
import type {
  FutureExecutor,
  FutureId,
  RejectCallback,
  ResolveCallback,
} from './future.js';
import {
  importInternalMethods,
  type InternalMethods,
} from './internal_methods.js';

import { assert_equal, assert_not_equal } from '../asserts.js';
import { Dictionary } from '../containers/dictionary.js';
import { DictionaryImpl } from '../containers/dictionary_impl.js';
import type { Entity } from '../containers/entity.js';
import {
  type AnyEntityConstructor,
  type EntityClass,
  State,
  StateBuilder,
} from '../containers/entity_impl.js';
import type { FutureSettledResult } from '../containers/future_settled_result.js';
import { List } from '../containers/list.js';
import { ListImpl } from '../containers/list_impl.js';
import { Struct } from '../containers/struct.js';
import { StructImpl } from '../containers/struct_impl.js';
import { FutureMachineDBTools } from '../database/future_machine_db_tools.js';
import {
  deserializeArgs,
  isSerializable,
  serialize,
  serializeArgs,
  serializeRecord,
  type ToArrayDB,
  type ToRecordDB,
} from '../database/serialize_utils.js';
import type { ExceptionOptions } from '../exceptions/exception.js';
import { ExceptionBoundary } from '../exceptions/exception_boundary.js';
import {
  DictionaryCreate,
  FutureCreate,
  FutureGetImpl,
  FutureMachineDBToolsCreate,
  ListCreate,
  MethodCreate,
  MethodGetImpl,
  StateCreate,
  StructCreate,
} from '../symbols.js';
import { Future } from './future.js';
import { FutureImpl, ReactionType, type ValidResult } from './future_impl.js';
import { Method, type MethodName } from './method.js';
import { type AnyMethodImpl, MethodImpl } from './method_impl.js';

// TODO: Should these exist here? Should they be exported from the module?
export type OnFulfillMethod<
  T extends Serializable,
  R extends Serializable,
> = Method<(result: T) => ValidResult<R>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OnRejectMethod<R extends Serializable> = OnFulfillMethod<any, R>;
export type OnFinallyMethod = Method<() => ValidResult<Serializable>>;

export type UnwrapFuture<T extends ValidResult<Serializable>> =
  T extends Future<infer U extends Serializable>
    ? UnwrapFuture<U>
    : T extends {
          then(
            onfulfilled: (
              result: infer U extends ValidResult<Serializable>,
              ...args: unknown[]
            ) => unknown,
            ...args: unknown[]
          ): unknown;
        }
      ? UnwrapFuture<U>
      : T;

export class FutureMachineImpl {
  // Whether or not we're "built" represents whether or not we are still adding
  // Methods to the `MethodMachine` or not.
  //
  // This boolean is not used by this, but instead directly get and set by
  // MethodMachine and FutureMachine.
  public built: boolean = false;

  private methodMaps: Record<
    MethodType,
    Map<MethodName, Method<AnyMethodImpl>>
  > = {
    [MethodType.External]: new Map(),
    [MethodType.Internal]: new Map(),
  };

  private entityMap: Map<string, EntityClass<AnyEntityConstructor>> = new Map();

  private internalMethods: InternalMethods;

  private ongoingCalls: number = 0;
  private onDonePromiseWithResolvers: PromiseWithResolvers<void> | undefined;

  constructor(private database: FutureDatabaseImpl) {
    database.setFutureMachineDBTools(
      FutureMachineDBTools[FutureMachineDBToolsCreate](this)
    );
    this.internalMethods = importInternalMethods(this);
  }

  private beginCall() {
    this.ongoingCalls++;
  }

  private endCall() {
    this.ongoingCalls--;
    if (
      this.onDonePromiseWithResolvers !== undefined &&
      this.ongoingCalls === 0
    ) {
      this.onDonePromiseWithResolvers.resolve();
      this.onDonePromiseWithResolvers = undefined;
    }
  }

  // Returns a promise that resolves when the FutureMachine has no more queued
  // work.
  public onActivitySettled(): Promise<void> {
    if (this.ongoingCalls === 0) {
      return Promise.resolve<void>(undefined);
    }
    if (this.onDonePromiseWithResolvers === undefined) {
      this.onDonePromiseWithResolvers = Promise.withResolvers();
    }
    return this.onDonePromiseWithResolvers.promise;
  }

  // TODO: This sounds like we're creating a MethodImpl. The intention was to be
  // the implementation of the createMethod/createInternalMethod methods.
  private createMethodImpl<Impl extends AnyMethodImpl>(
    type: MethodType,
    name: MethodName,
    impl: Impl
  ): Method<Impl> {
    const methodMap = this.methodMaps[type];
    if (methodMap.has(name)) {
      throw new Error(`Redefinition of '${name}'.`);
    }
    const methodDb = this.database.createMethodDB(name, type);
    const methodImpl = MethodImpl.create<Impl>(this, impl, methodDb);
    const method = Method[MethodCreate]<Impl>(methodImpl);
    methodDb.setFacade(method);
    methodMap.set(name, method);
    return method;
  }

  public createInternalMethod<Impl extends AnyMethodImpl>(
    name: MethodName,
    impl: Impl
  ): Method<Impl> {
    return this.createMethodImpl(MethodType.Internal, name, impl);
  }

  public createMethod<Impl extends AnyMethodImpl>(
    name: MethodName,
    impl: Impl
  ): Method<Impl> {
    return this.createMethodImpl(MethodType.External, name, impl);
  }

  public getMethodFromMethodDB(methodDb: MethodDB): Method<AnyMethodImpl> {
    let method = methodDb.getFacade();
    if (method === undefined) {
      const unboundMethod = this.methodMaps[methodDb.getType()].get(
        methodDb.getName()
      );
      if (unboundMethod === undefined) {
        return this.internalMethods.thrower.bindArgs(
          this.createException(
            `Method with name ${methodDb.getName()} not found`
          )
        );
      }
      method = Method[MethodCreate](
        MethodImpl.create(this, unboundMethod[MethodGetImpl]().impl, methodDb)
      );
      methodDb.setFacade(method);
    }
    return method;
  }

  public getEntityFromEntityDB(
    entityDb: EntityDB<Record<string, SerializableDB>>
  ) {
    let entity = entityDb.getFacade();

    if (entity === undefined) {
      const entityClass = this.entityMap.get(entityDb.getName());
      if (entityClass === undefined) {
        throw this.createException(
          `Entity with name ${entityDb.getName()} not found`
        );
      }
      entity = new entityClass(State[StateCreate](this, entityDb)) as Entity<
        Record<string, Serializable>
      >;
    }
    return entity;
  }

  public getFutureFromFutureDB<T extends Serializable>(
    futureDb: FutureDB<ToSerializableDB<T>>
  ): Future<T> {
    let future = futureDb.getFacade() as Future<T> | undefined;
    if (future === undefined) {
      future = this.createFutureImpl(futureDb);
    }
    return future;
  }

  public getDictionaryFromDictionaryDB<T extends Serializable>(
    dictionaryDb: DictionaryDB<ToSerializableDB<T>>
  ): Dictionary<T> {
    let dictionary = dictionaryDb.getFacade() as Dictionary<T>;
    if (dictionary === undefined) {
      dictionary = Dictionary[DictionaryCreate](
        new DictionaryImpl(this, dictionaryDb)
      );
      dictionaryDb.setFacade(dictionary);
    }
    return dictionary;
  }

  public getStructFromStructDB<T extends Record<string, Serializable>>(
    structDb: StructDB<ToRecordDB<T>>
  ): Struct<T> {
    let struct = structDb.getFacade() as Struct<T> | undefined;

    if (struct === undefined) {
      struct = Struct[StructCreate](new StructImpl(this, structDb));
      structDb.setFacade(
        struct as unknown as Struct<Record<string, Serializable>>
      );
    }

    return struct;
  }

  public getListFromListDB<T extends Serializable[]>(
    listDb: ListDB<ToArrayDB<T>>
  ): List<T> {
    let list = listDb.getFacade() as List<T>;
    if (list === undefined) {
      list = List[ListCreate](new ListImpl(this, listDb));
      listDb.setFacade(list);
    }
    return list;
  }

  public createFuture<T extends Serializable>(
    executor: FutureExecutor<T>
  ): Future<T> {
    const futureDb = this.database.createFutureDB<ToSerializableDB<T>>();
    return this.createFutureImpl<T>(futureDb, executor);
  }

  // TODO: This sounds like we're creating a FutureImpl. The intention was to be
  // the implementation of the createFuture method.
  private createFutureImpl<T extends Serializable>(
    futureDb: FutureDB<ToSerializableDB<T>>,
    executor?: FutureExecutor<T>
  ): Future<T> {
    const impl = new FutureImpl<T>(this, futureDb);

    // The `executor` should always be defined when created by `FutureMachine`'s
    // `createFuture`, but it it won't be defined when returned by a `next` or
    // `catch` call.
    if (executor) {
      const resolve = this.internalMethods.resolve.bindArgs(
        futureDb.getId() as FutureId<Serializable>
      );
      const reject = this.internalMethods.reject.bindArgs(futureDb.getId());
      try {
        executor(futureDb.getId() as FutureId<T>, resolve, reject);
      } catch (e) {
        this.rejectFutureByDB(futureDb, this.serializeThrownError(e));
      }
    }
    const future = Future[FutureCreate](impl);

    futureDb.setFacade(
      future as unknown as Future<FromSerializableDB<ToSerializableDB<T>>>
    );

    return future;
  }

  public createFutureWithResolvers<T extends Serializable>(): Struct<{
    future: Future<T>;
    id: FutureId<T>;
    resolve: ResolveCallback<T>;
    reject: RejectCallback;
  }> {
    let id: FutureId<T> | undefined;
    let resolve: ResolveCallback<T> | undefined;
    let reject: RejectCallback | undefined;
    const future = this.createFuture<T>((id_, resolve_, reject_) => {
      id = id_;
      resolve = resolve_;
      reject = reject_;
    });
    return this.createStruct({
      future,
      id: id!,
      resolve: resolve!,
      reject: reject!,
    });
  }

  public queueFutureReactionJob<T extends Serializable, R extends Serializable>(
    result: T,
    type: ReactionType,
    nextFutureDb: FutureDB<ToSerializableDB<R>>,
    methodDb?: MethodDB
  ) {
    this.beginCall();
    queueMicrotask(() => {
      // TODO: Should we implement this logic as internal Methods? And make
      // methodDb non-optional for a reaction. I think that doesn't increase or
      // decrease the amount we write to the database. Well other than that the
      // name string and internal boolean and empty bound args.
      if (methodDb === undefined) {
        if (type === ReactionType.Fulfill) {
          this.resolveFutureByDBNoSettledCheck<R>(
            nextFutureDb,
            // Double assertion valid since result will be forwarded as is to
            // the `nextFutureDb`.
            result as unknown as R
          );
        } else {
          this.triggerRejectReactions(nextFutureDb, result);
        }
        this.endCall();
        return;
      }

      const method = this.methodMaps[methodDb.getType()].get(
        methodDb.getName()
      );
      if (method === undefined) {
        // Once stable, we can never get rid of an internal method.
        assert_not_equal(
          methodDb.getType(),
          MethodType.Internal,
          'internal method not found'
        );
        this.triggerRejectReactions(
          nextFutureDb,
          this.createException(
            `Method with name ${methodDb.getName()} not found.`
          )
        );
        this.endCall();
        return;
      }
      try {
        this.resolveFutureByDBNoSettledCheck<R>(
          nextFutureDb,
          method(...deserializeArgs(this, methodDb.getBounded()), result) as R
        );
      } catch (e) {
        this.triggerRejectReactions(nextFutureDb, this.serializeThrownError(e));
      }
      this.endCall();
    });
  }

  private triggerFutureReactions<T extends Serializable>(
    reactions: Iterable<Reaction<SerializableDB>>,
    result: T,
    type: ReactionType
  ) {
    for (const { nextFutureDb, methodDb } of reactions) {
      this.queueFutureReactionJob(result, type, nextFutureDb, methodDb);
    }
  }

  private triggerFulfillReactions<T extends Serializable>(
    futureDb: FutureDB<ToSerializableDB<T>>,
    result: T
  ) {
    this.triggerFutureReactions(
      futureDb.fulfill(serialize(result)),
      result,
      ReactionType.Fulfill
    );
    futureDb
      .getPromiseWithResolvers()
      ?.resolve?.(result as FromSerializableDB<ToSerializableDB<T>>);
  }

  private triggerRejectReactions<T extends Serializable>(
    futureDb: FutureDB<ToSerializableDB<T>>,
    reason: Serializable
  ) {
    this.triggerFutureReactions(
      futureDb.reject(serialize(reason)),
      reason,
      ReactionType.Reject
    );
    futureDb.getPromiseWithResolvers()?.reject?.(reason);
  }

  private static IsPromiseLike<T>(value: unknown): value is PromiseLike<T> {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { then: unknown }).then === 'function'
    );
  }

  public resolveFutureById<T extends Serializable>(
    futureId: FutureId<T>,
    result: ValidResult<T>
  ) {
    const futureDb = this.database.getFutureDB(futureId);

    // If the database doesn't have the future, then we assume it has already
    // been settled.
    if (!futureDb) {
      return;
    }

    this.resolveFutureByDB(futureDb, result);
  }

  public resolveFutureByDB<T extends Serializable>(
    futureDb: FutureDB<ToSerializableDB<T>>,
    result: ValidResult<T>
  ) {
    if (futureDb.getAlreadySettled()) {
      return;
    }
    this.resolveFutureByDBNoSettledCheck(futureDb, result);
  }

  public resolveFutureByDBNoSettledCheck<T extends Serializable>(
    futureDb: FutureDB<ToSerializableDB<T>>,
    result: ValidResult<T>
  ) {
    assert_equal(futureDb.getState(), FutureState.Pending, 'settled futureDb');
    try {
      if (FutureMachineImpl.IsPromiseLike<T>(result)) {
        futureDb.settle();
        this.beginCall();
        queueMicrotask(() => {
          // TODO: What happens if you resolve a Future by a Promise that never
          // resolves?
          result.then(
            (value) => this.resolveFutureByDBNoSettledCheck<T>(futureDb, value),
            (value) => this.triggerRejectReactions<T>(futureDb, value)
          );
          this.endCall();
        });
        return;
      }
    } catch (e) {
      this.triggerRejectReactions(futureDb, this.serializeThrownError(e));
      return;
    }

    if (!(result instanceof Future)) {
      this.triggerFulfillReactions<T>(futureDb, result as T);
      return;
    }

    if (result[FutureGetImpl]().getFutureDB().equals(futureDb)) {
      this.triggerRejectReactions<T>(
        futureDb,
        this.createTypeException('A Future cannot resolve to itself.')
      );
      return;
    }

    futureDb.settle();
    this.beginCall();
    queueMicrotask(() => {
      result[FutureGetImpl]().nextWithFuture(futureDb);
      this.endCall();
    });
  }

  public rejectFutureById<T extends Serializable>(
    futureId: FutureId<T>,
    reason: Serializable
  ) {
    const futureDb = this.database.getFutureDB(futureId);

    // If the database doesn't have the future, then we assume it has already
    // been resolved or rejected.
    if (!futureDb || futureDb.getAlreadySettled()) {
      return;
    }

    this.rejectFutureByDB(futureDb, reason);
  }

  public rejectFutureByDB<T extends Serializable>(
    futureDb: FutureDB<ToSerializableDB<T>>,
    reason: Serializable
  ) {
    if (futureDb.getAlreadySettled()) {
      return;
    }
    this.triggerRejectReactions(futureDb, reason);
  }

  // Implementation of a normal `next` call.
  public addNext<
    T extends Serializable,
    R1 extends Serializable = T,
    R2 extends Serializable = never,
  >(
    futureDb: FutureDB<ToSerializableDB<T>>,
    onFulfilled?: OnFulfillMethod<T, R1>,
    onRejected?: OnRejectMethod<R2>
  ): Future<R1 | R2> {
    const onFulfilledImpl = onFulfilled
      ? onFulfilled[MethodGetImpl]()
      : undefined;
    const onRejectedImpl = onRejected ? onRejected[MethodGetImpl]() : undefined;
    const nextFutureDb = futureDb.pushReactions<ToSerializableDB<R1 | R2>>(
      onFulfilledImpl?.getMethodDb(),
      onRejectedImpl?.getMethodDb()
    );
    return this.createFutureImpl<R1 | R2>(nextFutureDb);
  }

  // Implementation of a `next` call when the `nextFutureId` is resolved with
  // `currentFutureId`.
  public addNextWithFuture<T extends SerializableDB, U extends SerializableDB>(
    currentFutureDb: FutureDB<T>,
    nextFutureDb: FutureDB<U>
  ) {
    currentFutureDb.pushReactionsWithFuture(nextFutureDb);
  }

  public resolve<T extends Serializable>(result: ValidResult<T>): Future<T> {
    if (result instanceof Future) {
      return result;
    }

    // TODO: This call to IsPromiseLike can throw.
    if (FutureMachineImpl.IsPromiseLike(result)) {
      // TODO: Consider going off spec? And converting PromiseLike to Future
      // instead of resolving a Future with PromiseLike. Conversion would mean
      // not queuing a microtask to trigger the Future's reactions on
      // PromiseLike settlement. But also have special handling if the Promise
      // resolves to a Future or PromiseLike.
      const { future, resolve } = this.createFutureWithResolvers<T>();
      resolve(result);
      return future;
    }

    return this.createFutureImpl<T>(
      this.database.createResolvedFutureDB<ToSerializableDB<T>>(
        serialize(result)
      )
    );
  }

  public reject<T extends Serializable = Serializable>(
    reason?: Serializable
  ): Future<T> {
    return this.createFutureImpl(
      this.database.createRejectedFutureDB(
        serialize(reason) as ToSerializableDB<T>
      )
    );
  }

  public finally<T extends Serializable>(
    future: FutureImpl<T>,
    onFinally: OnFinallyMethod
  ): Future<T> {
    return future.next(
      this.internalMethods.nextFinally.bindArgs(onFinally),
      this.internalMethods.catchFinally.bindArgs(onFinally)
    ) as Future<T>;
  }

  public race<T extends readonly ValidResult<Serializable>[]>(
    values: T
  ): Future<UnwrapFuture<T[number]>>;
  public race<T extends ValidResult<Serializable>>(
    values: Iterable<T>
  ): Future<UnwrapFuture<T>>;
  public race<T extends ValidResult<Serializable>>(
    values: Iterable<T>
  ): Future<Serializable> {
    const { future, resolve, reject } =
      this.createFutureWithResolvers<Serializable>();
    try {
      for (const value of values) {
        this.resolve(value).next(resolve, reject);
      }
    } catch (e) {
      reject(this.serializeThrownError(e));
    }
    return future;
  }

  public all<T extends readonly ValidResult<Serializable>[]>(
    values: T
  ): Future<List<{ -readonly [I in keyof T]: UnwrapFuture<T[I]> }>>;
  public all<T extends ValidResult<Serializable>>(
    values: Iterable<T>
  ): Future<List<UnwrapFuture<T>[]>>;
  public all<T extends ValidResult<Serializable>>(
    values: Iterable<T>
  ): Future<List<Serializable[]>> {
    const { future, id, resolve, reject } =
      this.createFutureWithResolvers<List<Serializable[]>>();

    const aggregateDb = this.database.createAggregateDB<SerializableDB>();
    let index = 0;
    try {
      for (const value of values) {
        const nextFuture = this.resolve(value);
        const onFulfilled = this.internalMethods.allResolveElement.bindArgs(
          id,
          // TODO: Find a better solution. `bind` doesn't allow pre-serialized
          // values. This works and doesn't cause any issues, but it breaks the
          // type system a bit.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          aggregateDb as any,
          index
        );
        nextFuture.next(onFulfilled, reject);
        index++;
      }
    } catch (e) {
      reject(this.serializeThrownError(e));
      return future;
    }
    aggregateDb.setElementCount(index);

    if (index === 0) {
      resolve(this.createList([]));
    }
    return future;
  }

  public any<T extends readonly ValidResult<Serializable>[]>(
    values: T
  ): Future<UnwrapFuture<T[number]>>;
  public any<T extends ValidResult<Serializable>>(
    values: Iterable<T>
  ): Future<UnwrapFuture<T>>;
  public any<T extends ValidResult<Serializable>>(
    values: Iterable<T>
  ): Future<Serializable> {
    const { future, id, resolve, reject } =
      this.createFutureWithResolvers<Serializable>();
    const aggregateDb = this.database.createAggregateDB();
    let index = 0;
    try {
      for (const value of values) {
        const nextFuture = this.resolve(value);
        const onRejected = this.internalMethods.anyRejectElement.bindArgs(
          id,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          aggregateDb as any,
          index
        );
        nextFuture.next(resolve, onRejected);
        index++;
      }
    } catch (e) {
      reject(this.serializeThrownError(e));
      return future;
    }
    aggregateDb.setElementCount(index);

    if (index === 0) {
      const exception = this.createAggregateException(
        this.createList([]),
        // TODO: We should move this to somewhere common. Or just bring back the
        // helper file and move the new test_helper method into it.
        'All futures were rejected'
      );
      reject(exception);
    }

    return future;
  }

  public allSettled<T extends readonly ValidResult<Serializable>[]>(
    values: T
  ): Future<
    List<{
      -readonly [I in keyof T]: FutureSettledResult<UnwrapFuture<T[I]>>;
    }>
  >;
  public allSettled<T extends ValidResult<Serializable>>(
    values: Iterable<T>
  ): Future<List<FutureSettledResult<UnwrapFuture<T>>[]>>;
  public allSettled<T extends ValidResult<Serializable>>(
    values: Iterable<T>
  ): Future<List<FutureSettledResult<Serializable>[]>> {
    const { future, id, resolve, reject } =
      this.createFutureWithResolvers<
        List<FutureSettledResult<Serializable>[]>
      >();

    const aggregateDb =
      this.database.createAggregateDB<
        ToSerializableDB<FutureSettledResult<Serializable>>
      >();
    let index = 0;
    try {
      for (const value of values) {
        const nextFuture = this.resolve(value);
        const onFulfilled =
          this.internalMethods.allSettledResolveElement.bindArgs(
            id as FutureId<List<Serializable[]>>,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            aggregateDb as any,
            index
          );
        const onRejected =
          this.internalMethods.allSettledRejectElement.bindArgs(
            id,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            aggregateDb as any,
            index
          );
        nextFuture.next(onFulfilled, onRejected);
        index++;
      }
    } catch (e) {
      reject(this.serializeThrownError(e));
      return future;
    }
    aggregateDb.setElementCount(index);

    if (index === 0) {
      resolve(this.createList([]));
    }
    return future;
  }

  public createDictionary<T extends Serializable>(): Dictionary<T> {
    const dictionaryDb =
      this.database.createDictionaryDB<ToSerializableDB<T>>();
    const dictionary = Dictionary[DictionaryCreate](
      new DictionaryImpl(this, dictionaryDb)
    );
    dictionaryDb.setFacade(dictionary);
    return dictionary;
  }

  // TODO: If T is a Struct, we should unwrap it. This would let us get rid of
  // `RawStruct`.
  public createStruct<T extends Record<string, Serializable>>(
    obj: T
  ): Struct<T> {
    // TODO: I wonder if for each container type, we should provide the database
    // an interface to get values as needed. And only then do we serialize.
    const structDb = this.database.createStructDB(serializeRecord(obj));
    const struct = Struct[StructCreate](new StructImpl(this, structDb));
    structDb.setFacade(
      struct as unknown as Struct<Record<string, Serializable>>
    );
    return struct;
  }

  public createList<T extends Serializable[]>(elements: T): List<T> {
    const listDb = this.database.createListDB<ToArrayDB<T>>([
      ...serializeArgs(elements),
    ] as ToArrayDB<T>);
    const list = List[ListCreate](new ListImpl(this, listDb));
    listDb.setFacade(list);
    return list;
  }

  public createEntityDB<T extends Record<string, SerializableDB>>(
    entityName: string,
    obj: T
  ): EntityDB<T> {
    return this.database.createEntityDB(entityName, obj);
  }

  public registerEntityImpl<
    E extends AnyEntityConstructor & EntityClass<E>,
    C extends (...args: unknown[]) => InstanceType<E> & Serializable,
  >(
    type: MethodType,
    name: string,
    entity: E,
    create: (stateBuilder: StateBuilder) => C
  ): Method<C> {
    if (this.entityMap.has(name)) {
      throw new Error(`Entity with name '${name}' already created`);
    }
    this.entityMap.set(name, entity);
    return this.createMethodImpl(type, name, (...args: unknown[]) => {
      return create(new StateBuilder(this, name))(...args);
    }) as Method<C>;
  }

  public registerEntity<
    E extends AnyEntityConstructor & EntityClass<E>,
    C extends (...args: unknown[]) => InstanceType<E> & Serializable,
  >(
    name: string,
    entity: E,
    create: (stateBuilder: StateBuilder) => C
  ): Method<C> {
    return this.registerEntityImpl(MethodType.External, name, entity, create);
  }

  public registerInternalEntity<
    E extends AnyEntityConstructor & EntityClass<E>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    C extends (...args: any[]) => InstanceType<E> & Serializable,
  >(
    name: string,
    entity: E,
    create: (stateBuilder: StateBuilder) => C
  ): Method<C> {
    return this.registerEntityImpl(MethodType.Internal, name, entity, create);
  }

  public createException(message?: string, options?: ExceptionOptions) {
    // TODO: We could just expose this `Method` directly, but I feel like it
    // would confuse the FutureMachine interface by mixing normal methods and
    // `Method`s. We could also try to have all the methods of FutureMachine be
    // a Method.
    return this.internalMethods.createException(message, options);
  }

  public createTypeException(message?: string, options?: ExceptionOptions) {
    // TODO: We could just expose this `Method` directly, but I feel like it
    // would confuse the FutureMachine interface by mixing normal methods and
    // `Method`s. We could also try to have all the methods of FutureMachine be
    // a Method.
    return this.internalMethods.createTypeException(message, options);
  }

  public createAggregateException(
    errors: List<Serializable[]>,
    message?: string,
    options?: ExceptionOptions
  ) {
    // TODO: We could just expose this `Method` directly, but I feel like it
    // would confuse the FutureMachine interface by mixing normal methods and
    // `Method`s. We could also try to have all the methods of FutureMachine be
    // a Method.
    return this.internalMethods.createAggregateException(
      errors,
      message,
      options
    );
  }

  public serializeThrownError(e: unknown): Serializable {
    using _ = new ExceptionBoundary(this.serializeThrownError);
    if (isSerializable(e)) {
      return e;
    }

    // TODO: Add info about `e` to the serializable exception.
    return this.createSerializableException(
      // TODO: I actually think we should have custom error messages for each
      // call site.
      'A value was thrown that was not serializable'
    );
  }

  public createSerializableException(
    message?: string,
    options?: ExceptionOptions
  ) {
    // TODO: We could just expose this `Method` directly, but I feel like it
    // would confuse the FutureMachine interface by mixing normal methods and
    // `Method`s. We could also try to have all the methods of FutureMachine be
    // a Method.
    return this.internalMethods.createSerializableException(message, options);
  }
}
