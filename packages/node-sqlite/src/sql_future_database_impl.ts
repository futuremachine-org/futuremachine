import type {
  AggregateDB,
  DictionaryDB,
  EntityDB,
  FromSerializableDB,
  FutureDB,
  FutureId,
  FutureMachineDBTools,
  MethodDB,
  MethodName,
  MethodType,
  ObjectDB,
  Reaction,
  Serializable,
  SerializableDB,
  StructDB,
  ToSerializableDB,
} from '@futuremachine/core';
import { FutureDatabaseImpl, FutureState } from '@futuremachine/core';
import {
  assert_defined,
  assert_not_equal,
  assert_not_null,
  assert_unreached,
} from './asserts.js';
import { SQLAggregateDB } from './sql_aggregate_db.js';
import {
  BooleanDb,
  type FutureIdDb,
  type MethodIdDb,
  type ObjectIdDb,
  SqlDatabaseIntf,
  SQLObjectType,
  ValueType,
} from './sql_database_intf.js';
import { SQLDictionaryDB } from './sql_dictionary_db.js';
import { SQLEntityDB } from './sql_entity_db.js';
import { SQLFutureDB } from './sql_future_db.js';
import { SQLListDB } from './sql_list_db.js';
import { SQLMethodDB } from './sql_method_db.js';
import { SQLStructDB } from './sql_struct_db.js';
import { WeakCache } from './weak_cache.js';

export interface PendingWrite {
  write(): void;
}

export class SQLFutureDatabaseImpl extends FutureDatabaseImpl {
  private databaseIntf: SqlDatabaseIntf;

  private futureMachineDBTools: FutureMachineDBTools | undefined;

  private unboundMethodMap = new Map<MethodName, MethodDB>();

  private futureDbCache: WeakCache<FutureIdDb, FutureDB<SerializableDB>> =
    new WeakCache();
  private objectDbCache: WeakCache<ObjectIdDb, ObjectDB> = new WeakCache();
  private methodDbCache: WeakCache<MethodIdDb, MethodDB> = new WeakCache();

  private pendingWrites: Set<PendingWrite> = new Set();

  private garbageCollectionCount = 0;

  constructor(databasePath: string) {
    super();
    this.databaseIntf = new SqlDatabaseIntf(databasePath);
  }

  public setFutureMachineDBTools(futureMachineDBTools: FutureMachineDBTools) {
    this.futureMachineDBTools = futureMachineDBTools;
  }

  public pushPendingWrite(pendingWrite: PendingWrite) {
    this.pendingWrites.add(pendingWrite);
  }

  public async close() {
    await this.flush();
    this.databaseIntf.close();
  }

  public async flush() {
    await this.futureMachineDBTools?.onActivitySettled();
    this.databaseIntf.startFlush();
    this.databaseIntf.startTransaction();
    for (const pendingWrite of this.pendingWrites) {
      pendingWrite.write();
    }
    // TODO: Create a test that verifies that you called clear here.
    this.pendingWrites.clear();
    this.databaseIntf.endTransaction();
    this.databaseIntf.endFlush();
  }

  public isInFlush() {
    return this.databaseIntf.isInFlush();
  }

  public getGarbageCollectionCount() {
    return this.garbageCollectionCount;
  }

  public futuresHasId(id: FutureIdDb) {
    return this.databaseIntf.futuresHasId(id);
  }

  public methodsHasId(id: MethodIdDb) {
    return this.databaseIntf.methodsHasId(id);
  }

  public objectsHasId(id: ObjectIdDb) {
    return this.databaseIntf.objectsHasId(id);
  }

  private pushFuturesToSets(
    futuresSet: FutureIdDb[],
    futures: {
      id: FutureIdDb;
    }[]
  ) {
    for (const { id } of futures) {
      futuresSet.push(id);
    }
  }

  private pushValuesToSets(
    futureSet: FutureIdDb[],
    methodsSet: MethodIdDb[],
    objectsSet: ObjectIdDb[],
    values: {
      valueType: ValueType | null;
      value: string | null;
    }[]
  ) {
    for (const { valueType, value } of values) {
      switch (valueType) {
        case ValueType.Method:
          methodsSet.push(Number(value));
          break;
        case ValueType.Obj:
          objectsSet.push(Number(value));
          break;
        case ValueType.Future:
          assert_not_null(value, 'A value of Future type had a null id.');
          futureSet.push(value);
          break;
        default:
          break;
      }
    }
  }

  private pushReactionsToSets(
    futuresSet: FutureIdDb[],
    methodsSet: MethodIdDb[],
    reactions: {
      nextFutureId: FutureIdDb;
      methodId: MethodIdDb | null;
    }[]
  ) {
    for (const { nextFutureId, methodId } of reactions) {
      futuresSet.push(nextFutureId);
      if (methodId !== null) {
        methodsSet.push(methodId);
      }
    }
  }

  // TODO: I think I could probably move most of this logic to a class. One
  // major benefit of this, would be that I don't have to have a bunch of
  // functions with all the sets as arguments. Instead these functions would be
  // methods, and the sets would be members. Then you could have `pushValue`
  // which all the ObjectDBs would implement.
  public async gc() {
    await this.flush();
    this.databaseIntf.startTransaction();

    // TODO: Should these actually be sets? That way it's not possible to have
    // duplicates. But why are we getting duplicates in the first place? Oh one
    // reason is that fulfill and reject have the same nextFutureId and we don't
    // check if that's been marked yet. I'm betting there's actually a lot of
    // cases like that.
    const futuresSet: FutureIdDb[] = [];
    const methodsSet: MethodIdDb[] = [];
    const objectsSet: ObjectIdDb[] = [];

    this.databaseIntf.flipCurrentMark();

    const roots = this.databaseIntf.getAndMarkRoots();
    this.pushFuturesToSets(futuresSet, roots);

    let futuresSetIsForRoots = true;

    let hasWork = true;

    // This loops
    while (hasWork) {
      hasWork = false;

      if (futuresSet.length > 0) {
        hasWork = true;

        // Traverse the Future's resolved values. The roots have already pushed
        // their values to the sets, so we don't need to do it again.
        const values = futuresSetIsForRoots
          ? []
          : this.databaseIntf.getAndMarkFutures(futuresSet);
        futuresSetIsForRoots = false;

        // Traverse the reactions to both their next futures and their methods.
        const fulfillReactions =
          this.databaseIntf.getAndMarkFulfillReactions(futuresSet);
        const rejectReactions =
          this.databaseIntf.getAndMarkRejectReactions(futuresSet);
        futuresSet.length = 0;

        this.pushReactionsToSets(futuresSet, methodsSet, fulfillReactions);
        this.pushReactionsToSets(futuresSet, methodsSet, rejectReactions);
        this.pushValuesToSets(futuresSet, methodsSet, objectsSet, values);
      }

      if (methodsSet.length > 0) {
        hasWork = true;

        // Traverse the bounded arguments of the methods.
        const methods = this.databaseIntf.getAndMarkMethods(methodsSet);
        methodsSet.length = 0;

        for (const method of methods) {
          const bounded = this.databaseIntf.fromBoundedDb(method.bounded);
          this.pushValuesToSets(futuresSet, methodsSet, objectsSet, bounded);
        }
      }

      if (objectsSet.length > 0) {
        hasWork = true;

        // Traverse all members of the objects.
        const objects = this.databaseIntf.getAndMarkObjects(objectsSet);
        objectsSet.length = 0;

        for (const { type, value: valueString } of objects) {
          const value = JSON.parse(valueString);
          switch (type) {
            case SQLObjectType.Aggregate: {
              SQLAggregateDB.GetIds(futuresSet, methodsSet, objectsSet, value);
              break;
            }
            case SQLObjectType.Dictionary: {
              SQLDictionaryDB.GetIds(futuresSet, methodsSet, objectsSet, value);
              break;
            }
            case SQLObjectType.Struct: {
              SQLStructDB.GetIds(futuresSet, methodsSet, objectsSet, value);
              break;
            }
            case SQLObjectType.List: {
              SQLListDB.GetIds(futuresSet, methodsSet, objectsSet, value);
              break;
            }
            case SQLObjectType.Entity: {
              SQLEntityDB.GetIds(futuresSet, methodsSet, objectsSet, value);
              break;
            }
            /* c8 ignore next 2 */
            default:
              assert_unreached('Not supported');
          }
        }
      }
    }

    this.databaseIntf.sweepUnmarkedObjects();

    this.databaseIntf.endTransaction();

    this.garbageCollectionCount++;
  }

  // TODO: These functions are for the Dot exporter. Add back
  //
  // getFutureIds(): FutureId[] {
  //   return [...this.futureMap.keys()];
  // }

  // getReactions(futureId: FutureId): {
  //   fulfillReactions: Reaction<any>[];
  //   rejectReactions: Reaction<any>[];
  // } {
  //   return this.futureMap.get(futureId)!;
  // }

  private boundedToValueArray(bounded: Generator<SerializableDB>): {
    valueType: ValueType;
    value: string;
  }[] {
    const boundedDb = bounded.map((value) => this.toInternalValue(value));
    return [...boundedDb];
  }

  public getNextMethodId() {
    return this.databaseIntf.getNextMethodId();
  }

  public writeMethodDb(methodDb: SQLMethodDB) {
    this.methodDbCache.set(methodDb.getId(), methodDb);
    this.databaseIntf.createMethod(
      methodDb.getId(),
      methodDb.getName(),
      methodDb.getType(),
      this.boundedToValueArray(methodDb.getBounded())
    );
  }

  private getMethodDb(id: MethodIdDb): MethodDB {
    const cachedMethod = this.methodDbCache.get(id);
    if (cachedMethod !== undefined) {
      return cachedMethod;
    }
    const { name, type, bounded: boundedDb } = this.databaseIntf.getMethod(id);
    if (boundedDb.length === 0) {
      const methodDb = this.unboundMethodMap.get(name);
      if (methodDb !== undefined) {
        return methodDb;
      }
    }
    const bounded: SerializableDB[] = boundedDb.map(({ valueType, value }) => {
      return this.fromInternalValue(valueType, value);
    });
    return new SQLMethodDB(this, name, type, bounded, id);
  }

  public settleFutureDb(futureId: FutureIdDb) {
    this.databaseIntf.setFutureSettled(futureId);
  }

  public getFutureReactions(
    futureId: FutureIdDb,
    state: FutureState
  ): Reaction<SerializableDB>[] {
    let reactionsDb;
    switch (state) {
      case FutureState.Fulfilled:
        reactionsDb = this.databaseIntf.getFulfillReactions(futureId);
        break;
      case FutureState.Rejected:
        reactionsDb = this.databaseIntf.getRejectReactions(futureId);
        break;
      /* c8 ignore next 2 */
      case FutureState.Pending:
        assert_unreached('Invalid reaction state');
    }

    const reactions: Reaction<SerializableDB>[] = reactionsDb.map(
      ({ nextFutureId, methodId }) => {
        return {
          nextFutureDb: this.getFutureDB(
            this.databaseIntf.fromFutureIdDb(nextFutureId)
          )!,
          methodDb: methodId !== null ? this.getMethodDb(methodId) : undefined,
        };
      }
    );

    return reactions;
  }

  public setFutureState<T extends SerializableDB>(
    futureId: FutureIdDb,
    state: FutureState,
    result: T
  ) {
    const { value: internalValue, valueType } = this.toInternalValue(result);

    this.databaseIntf.setFutureFulfillOrReject(
      futureId,
      state,
      valueType,
      internalValue
    );
  }

  public deleteReactions(state: FutureState, futureId: FutureIdDb) {
    switch (state) {
      case FutureState.Fulfilled:
        this.databaseIntf.deleteFulfillReactions(futureId);
        break;
      case FutureState.Rejected:
        this.databaseIntf.deleteRejectReactions(futureId);
        break;
      /* c8 ignore next 2 */
      case FutureState.Pending:
        assert_unreached('Invalid reaction state');
    }
  }

  public pushReactions(
    currentId: FutureIdDb,
    state: FutureState,
    reactions: Reaction<SerializableDB>[]
  ) {
    // TODO: These statements may throw. If they do, you may want to call
    // rollback. But we need to analyze what sorts of errors can actually
    // happen.

    assert_not_equal(state, FutureState.Pending, 'Invalid reaction state');

    const createReaction =
      state === FutureState.Fulfilled
        ? this.databaseIntf.createFulfillReaction
        : this.databaseIntf.createRejectReaction;

    for (const { nextFutureDb, methodDb } of reactions) {
      const nextId = (
        nextFutureDb as SQLFutureDB<SerializableDB>
      ).getInternalId();
      createReaction.call(
        this.databaseIntf,
        currentId,
        nextId,
        (methodDb as SQLMethodDB | undefined)?.getOrCreateId()
      );
    }
  }

  public createMethodDB(name: MethodName, type: MethodType): MethodDB {
    const methodDb = new SQLMethodDB(this, name, type, []);
    this.unboundMethodMap.set(name, methodDb);
    return methodDb;
  }

  public writeFutureDb<T extends SerializableDB>(
    futureDb: SQLFutureDB<T>,
    id: FutureIdDb,
    root: boolean,
    result: T | undefined,
    reason: SerializableDB | undefined,
    state: FutureState,
    alreadySettled: boolean
  ) {
    let valueType: ValueType | undefined;
    let internalValue: string | undefined;
    if (state === FutureState.Fulfilled) {
      const valueDb = this.toInternalValue(result);
      valueType = valueDb.valueType;
      internalValue = valueDb.value;
    } else if (state === FutureState.Rejected) {
      const valueDb = this.toInternalValue(reason);
      valueType = valueDb.valueType;
      internalValue = valueDb.value;
    }
    this.databaseIntf.createFuture(
      id,
      root,
      state,
      alreadySettled,
      valueType,
      internalValue
    );
  }

  // Creates a unique id.
  public createFutureId(): FutureIdDb {
    return crypto.randomUUID().replace(/-/g, '');
  }

  private createFutureDBImpl<T extends SerializableDB>(
    root: boolean,
    result: T | undefined,
    reason: SerializableDB | undefined,
    state: FutureState,
    alreadySettled: boolean
  ): FutureDB<T> {
    const internalId = this.createFutureId();
    const id = this.databaseIntf.fromFutureIdDb<T>(internalId);
    const futureDb = new SQLFutureDB<T>(
      this,
      root,
      /* inDatabase = */ false,
      id,
      internalId,
      result,
      reason,
      state,
      alreadySettled
    );

    this.futureDbCache.set(internalId, futureDb as FutureDB<SerializableDB>);
    return futureDb;
  }

  public createNextFutureDB<T extends SerializableDB>(): FutureDB<T> {
    return this.createFutureDBImpl<T>(
      /* root = */ false,
      /* result = */ undefined,
      /* reason = */ undefined,
      FutureState.Pending,
      /* alreadySettled = */ false
    );
  }

  public createFutureDB<T extends SerializableDB>(): FutureDB<T> {
    return this.createFutureDBImpl<T>(
      /* root = */ true,
      /* result = */ undefined,
      /* reason = */ undefined,
      FutureState.Pending,
      /* alreadySettled = */ false
    );
  }

  public createResolvedFutureDB<T extends SerializableDB>(
    result: T | undefined
  ): FutureDB<T> {
    return this.createFutureDBImpl<T>(
      /* root = */ false,
      result,
      /* reason = */ undefined,
      FutureState.Fulfilled,
      /* alreadySettled = */ true
    );
  }

  public createRejectedFutureDB<T extends SerializableDB>(
    reason: SerializableDB | undefined
  ): FutureDB<T> {
    return this.createFutureDBImpl<T>(
      /* root = */ false,
      /* result = */ undefined,
      reason,
      FutureState.Rejected,
      /* alreadySettled = */ true
    );
  }

  public updateObjectDb(objectId: ObjectIdDb, objectJson: unknown) {
    this.databaseIntf.updateObject(objectId, objectJson);
  }

  public deleteObjectDb(objectId: ObjectIdDb) {
    this.databaseIntf.deleteObject(objectId);
  }

  public getNextObjectId() {
    return this.databaseIntf.getNextObjectId();
  }

  public createObjectDBWithValue(
    objectId: ObjectIdDb,
    type: SQLObjectType,
    object: ObjectDB,
    value: unknown
  ): ObjectIdDb {
    this.databaseIntf.createObject(objectId, type, value);
    this.objectDbCache.set(objectId, object);
    return objectId;
  }

  public getObjectDb<T extends SerializableDB>(id: ObjectIdDb): T {
    const cachedObject = this.objectDbCache.get(id) as T | undefined;
    if (cachedObject !== undefined) {
      return cachedObject;
    }
    const { type, value } = this.databaseIntf.getObject(id);
    switch (type) {
      case SQLObjectType.Aggregate: {
        return SQLAggregateDB.Deserialize(
          this,
          this.objectDbCache,
          id,
          value
        ) as unknown as T;
      }
      case SQLObjectType.Dictionary: {
        return SQLDictionaryDB.Deserialize(
          this,
          this.objectDbCache,
          id,
          value
        ) as unknown as T;
      }
      case SQLObjectType.Struct: {
        return SQLStructDB.Deserialize(
          this,
          this.objectDbCache,
          id,
          value
        ) as unknown as T;
      }
      case SQLObjectType.List: {
        return SQLListDB.Deserialize(
          this,
          this.objectDbCache,
          id,
          value
        ) as unknown as T;
      }
      case SQLObjectType.Entity: {
        return SQLEntityDB.Deserialize(
          this,
          this.objectDbCache,
          id,
          value
        ) as unknown as T;
      }
      /* c8 ignore next 2 */
      default:
        assert_unreached('Not supported');
    }
  }

  public toInternalValue(value: SerializableDB): {
    valueType: ValueType;
    value: string;
  } {
    switch (typeof value) {
      case 'boolean': {
        return {
          valueType: ValueType.Boolean,
          value: this.databaseIntf.toBooleanDb(value).toString(),
        };
      }
      case 'number': {
        return {
          valueType: ValueType.Number,
          value: value.toString(),
        };
      }
      case 'bigint': {
        return {
          valueType: ValueType.Bigint,
          value: value.toString(),
        };
      }
      case 'string': {
        return {
          valueType: ValueType.String,
          value: value,
        };
      }
      case 'undefined': {
        return {
          valueType: ValueType.Undefined,
          value: '',
        };
      }
      case 'object': {
        if (value === null) {
          return {
            valueType: ValueType.Null,
            value: '',
          };
        }

        if (value instanceof SQLFutureDB) {
          return {
            valueType: ValueType.Future,
            value: value.getInternalId().toString(),
          };
        }

        if (value instanceof SQLMethodDB) {
          return {
            valueType: ValueType.Method,
            value: value.getOrCreateId().toString(),
          };
        }

        if (value instanceof SQLAggregateDB) {
          return {
            valueType: ValueType.Obj,
            value: value.getOrCreateId().toString(),
          };
        }

        if (value instanceof SQLDictionaryDB) {
          return {
            valueType: ValueType.Obj,
            value: value.getOrCreateId().toString(),
          };
        }

        if (value instanceof SQLStructDB) {
          return {
            valueType: ValueType.Obj,
            value: value.getOrCreateId().toString(),
          };
        }

        if (value instanceof SQLListDB) {
          return {
            valueType: ValueType.Obj,
            value: value.getOrCreateId().toString(),
          };
        }

        if (value instanceof SQLEntityDB) {
          return {
            valueType: ValueType.Obj,
            value: value.getOrCreateId().toString(),
          };
        }
        /* c8 ignore next 2 */
        assert_unreached('Not supported.');
        break;
      }
      /* c8 ignore next 3 */
      case 'symbol':
      case 'function':
        assert_unreached('Not supported');
    }
  }

  public fromInternalValue(
    valueType: ValueType,
    value: string
  ): SerializableDB {
    switch (valueType) {
      case ValueType.Boolean:
        return Number(value) === BooleanDb.True;
      case ValueType.Number:
        return Number(value);
      case ValueType.Bigint:
        return BigInt(value);
      case ValueType.String:
        return value;
      case ValueType.Undefined:
        return undefined;
      case ValueType.Null:
        return null;
      case ValueType.Future:
        return this.getFutureDB(this.databaseIntf.fromFutureIdDb(value));
      case ValueType.Method:
        return this.getMethodDb(Number(value));
      case ValueType.Obj:
        return this.getObjectDb<SerializableDB>(Number(value));
    }
  }

  public getFutureDB<T extends Serializable>(
    futureId: FutureId<T>
  ): FutureDB<ToSerializableDB<T>> | undefined {
    const internalId = this.databaseIntf.toFutureIdDb(futureId);
    if (internalId === undefined) {
      return undefined;
    }

    {
      const futureDb = this.futureDbCache.get(internalId);
      if (futureDb !== undefined) {
        return futureDb as FutureDB<ToSerializableDB<T>>;
      }
    }
    const result = this.databaseIntf.getFuture(internalId);
    if (result === undefined) {
      return undefined;
    }

    const { root, state, alreadySettled, valueType, value } = result;

    const futureDb = new SQLFutureDB<ToSerializableDB<T>>(
      this,
      root,
      /* inDatabase = */ true,
      futureId as FutureId<FromSerializableDB<ToSerializableDB<T>>>,
      internalId,
      state === FutureState.Fulfilled
        ? (this.fromInternalValue(valueType!, value!) as ToSerializableDB<T>)
        : undefined,
      state === FutureState.Rejected
        ? this.fromInternalValue(valueType!, value!)
        : undefined,
      state,
      alreadySettled
    );
    this.futureDbCache.set(internalId, futureDb as FutureDB<SerializableDB>);
    return futureDb;
  }

  public createAggregateDB<T extends SerializableDB>(): AggregateDB<T> {
    return new SQLAggregateDB<T>(this);
  }

  public createDictionaryDB<T extends SerializableDB>(): DictionaryDB<T> {
    return new SQLDictionaryDB<T>(this, undefined);
  }

  public createStructDB<T extends Record<string, SerializableDB>>(
    obj: T
  ): StructDB<T> {
    // Shallow copy the obj so that the caller can't modify it later.
    return new SQLStructDB<T>(this, undefined, { ...obj });
  }

  public createListDB<T extends SerializableDB[]>(elements: T): SQLListDB<T> {
    return new SQLListDB<T>(this, undefined, elements);
  }

  public createEntityDB<T extends Record<string, SerializableDB>>(
    entityName: string,
    obj: T
  ): EntityDB<T> {
    // Shallow copy the obj so that the caller can't modify it later.
    return new SQLEntityDB(this, undefined, entityName, { ...obj });
  }

  public getReactionsCountForTesting() {
    return this.databaseIntf.getReactionsCountForTesting();
  }

  public getFuturesCountForTesting() {
    return this.databaseIntf.getFuturesCountForTesting();
  }

  public getFutureStateForTesting(futureId: FutureId<Serializable>) {
    const id = this.databaseIntf.toFutureIdDb(futureId);
    assert_defined(
      id,
      'Update this function if passing invalid ids to this function is needed for testing.'
    );
    return this.databaseIntf.getFuture(id);
  }

  public getMethodsCountForTesting() {
    return this.databaseIntf.getMethodsCountForTesting();
  }

  public getObjectsCountForTesting() {
    return this.databaseIntf.getObjectsCountForTesting();
  }

  public getFutureDbCacheSizeForTesting(): number {
    return this.futureDbCache.size();
  }

  public getMethodDbCacheSizeForTesting(): number {
    return this.methodDbCache.size();
  }

  public getObjectDbCacheSizeForTesting(): number {
    return this.objectDbCache.size();
  }
}
