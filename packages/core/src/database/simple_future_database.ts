import { assert_defined, assert_less_than } from '../asserts.js';
import type { Dictionary } from '../containers/dictionary.js';
import type { Entity } from '../containers/entity.js';
import type { List } from '../containers/list.js';
import type { Struct } from '../containers/struct.js';
import type { Future, FutureId } from '../core/future.js';
import type { Method } from '../core/method.js';
import { type AnyMethodImpl, type MethodName } from '../core/method_impl.js';
import type { Database } from '../tools/dot.js';
import {
  type AggregateDB,
  type DictionaryDB,
  type EntityDB,
  type FromSerializableDB,
  type FutureDatabase,
  FutureDatabaseImpl,
  type FutureDB,
  FutureState,
  GetFutureDatabase,
  type ListDB,
  type ListElement,
  type MethodDB,
  MethodType,
  ObjectDB,
  ObjectDBType,
  type Reaction,
  type Serializable,
  type SerializableDB,
  type StructDB,
  type ToSerializableDB,
} from './future_database.js';
import type { FutureMachineDBTools } from './future_machine_db_tools.js';

type FutureMapEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  futureDb: SimpleFutureDB<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fulfillReactions: Reaction<any>[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rejectReactions: Reaction<any>[];
};
type FutureMap = Map<FutureId<Serializable>, FutureMapEntry>;
export type SimpleFutureDatabaseState = {
  futureMap: FutureMap;
  idCounter: number;
};

class SimpleMethodDB extends ObjectDB implements MethodDB {
  private facade: Method<AnyMethodImpl> | undefined;

  constructor(
    private database: SimpleFutureDatabaseImpl,
    private dbInstanceId: number,
    private name: MethodName,
    private type: MethodType,
    private bounded: SerializableDB[]
  ) {
    super();
  }

  public isUnbounded() {
    return this.bounded.length === 0;
  }

  public getObjectType(): ObjectDBType.Method {
    return ObjectDBType.Method;
  }

  public setFacade(facade: Method<AnyMethodImpl>): void {
    this.dbInstanceId = this.database.getInstanceId();
    this.facade = facade;
  }

  public getFacade(): Method<AnyMethodImpl> | undefined {
    if (this.dbInstanceId !== this.database.getInstanceId()) {
      return undefined;
    }
    return this.facade;
  }

  public getName(): MethodName {
    return this.name;
  }

  public getType(): MethodType {
    return this.type;
  }

  public *getBounded(): Generator<SerializableDB> {
    yield* this.database.deserializeIter(this.bounded);
  }

  public pushBounded(args: Generator<SerializableDB>): MethodDB {
    return new SimpleMethodDB(
      this.database,
      this.dbInstanceId,
      this.name,
      this.type,
      [...this.bounded, ...args]
    );
  }
}

class SimpleFutureDB<T extends SerializableDB>
  extends ObjectDB
  implements FutureDB<T>
{
  private facade: Future<FromSerializableDB<T>> | undefined;
  private promiseWithResolvers:
    | Partial<PromiseWithResolvers<FromSerializableDB<T>>>
    | undefined;

  constructor(
    private database: SimpleFutureDatabaseImpl,
    private dbInstanceId: number,
    private id: FutureId<FromSerializableDB<T>> | undefined,
    private result: T | undefined,
    private reason: SerializableDB | undefined,
    private state: FutureState,
    private alreadySettled: boolean
  ) {
    super();
  }

  public getObjectType(): ObjectDBType.Future {
    return ObjectDBType.Future;
  }

  public setFacade(facade: Future<FromSerializableDB<T>>): void {
    this.dbInstanceId = this.database.getInstanceId();
    this.facade = facade;
  }

  public getFacade(): Future<FromSerializableDB<T>> | undefined {
    if (this.dbInstanceId !== this.database.getInstanceId()) {
      return undefined;
    }
    return this.facade;
  }

  public getId(): FutureId<FromSerializableDB<T>> {
    assert_defined(this.id, 'Attempted to get an undefined id.');
    return this.id;
  }

  public getResult(): T | undefined {
    return this.database.deserialize(this.result);
  }

  public getReason(): SerializableDB | undefined {
    return this.database.deserialize(this.reason);
  }

  public getState(): FutureState {
    return this.state;
  }

  public getAlreadySettled(): boolean {
    return this.alreadySettled;
  }

  public equals(other: SimpleFutureDB<T>): boolean {
    return other.id === this.id;
  }

  public pushReactions<U extends SerializableDB>(
    onFulfilled?: MethodDB,
    onRejected?: MethodDB
  ): FutureDB<U> {
    const nextFutureDb = this.database.createFutureDB<U>();
    this.database.pushReactionsImpl(
      this,
      nextFutureDb,
      onFulfilled,
      onRejected
    );
    return nextFutureDb;
  }

  public pushReactionsWithFuture<U extends SerializableDB>(
    nextFutureId: FutureDB<U>
  ): void {
    this.database.pushReactionsImpl(this, nextFutureId);
  }

  public *fulfill(result: T): Generator<Reaction<SerializableDB>> {
    this.state = FutureState.Fulfilled;
    this.result = result;
    this.alreadySettled = true;
    const futureReactions = this.database.takeFutureReactions(this);
    yield* futureReactions.fulfillReactions;
  }

  public *reject(reason: SerializableDB): Generator<Reaction<SerializableDB>> {
    this.state = FutureState.Rejected;
    this.reason = reason;
    this.alreadySettled = true;
    const futureReactions = this.database.takeFutureReactions(this);
    yield* futureReactions.rejectReactions;
  }

  public settle(): void {
    this.alreadySettled = true;
  }

  public getPromiseWithResolvers():
    | Partial<PromiseWithResolvers<FromSerializableDB<T>>>
    | undefined {
    return this.promiseWithResolvers;
  }

  public setPromiseWithResolvers(
    promiseWithResolvers:
      | Partial<PromiseWithResolvers<FromSerializableDB<T>>>
      | undefined
  ): void {
    this.promiseWithResolvers = promiseWithResolvers;
  }
}

class SimpleAggregateDB<T extends SerializableDB>
  extends ObjectDB
  implements AggregateDB<T>
{
  private values: ListDB<T[]> | undefined;
  private remainingElementCount: number = 0;

  constructor(
    private database: SimpleFutureDatabaseImpl,
    private dbInstanceId: number
  ) {
    super();
  }

  public getObjectType(): ObjectDBType.Aggregate {
    return ObjectDBType.Aggregate;
  }

  public setElementCount(count: number): void {
    this.values = new SimpleListDB<T[]>(
      this.database,
      this.dbInstanceId,
      new Array(count).fill(undefined)
    );
    this.remainingElementCount = count;
  }
  // Sets the resolution value at `index` to `value`. If all indices have a
  // resolution value, it returns their values. Otherwise, returns undefined.
  public settleElement<U extends T>(
    index: number,
    value: U
  ): ListDB<T[]> | undefined {
    assert_defined(
      this.values,
      'resolveElement should never be called before `setElementCount` has been called'
    );
    assert_less_than(index, this.values.size(), 'index is out of range');
    this.values.set([value], index);
    this.remainingElementCount--;
    if (this.remainingElementCount === 0) {
      return this.values;
    }
  }
}

class SimpleDictionaryDB<T extends SerializableDB>
  extends ObjectDB
  implements DictionaryDB<T>
{
  private facade: Dictionary<Serializable> | undefined;
  private map: Map<string, T> = new Map();

  constructor(
    private database: SimpleFutureDatabaseImpl,
    private dbInstanceId: number
  ) {
    super();
  }

  public setFacade(facade: Dictionary<Serializable>): void {
    this.dbInstanceId = this.database.getInstanceId();
    this.facade = facade;
  }
  public getFacade(): Dictionary<Serializable> | undefined {
    if (this.dbInstanceId !== this.database.getInstanceId()) {
      return undefined;
    }
    return this.facade;
  }

  public getObjectType(): ObjectDBType.Dictionary {
    return ObjectDBType.Dictionary;
  }

  public get(key: string): T | undefined {
    return this.database.deserialize(this.map.get(key));
  }

  public set(key: string, value: T): void {
    this.map.set(key, value);
  }

  public has(key: string): boolean {
    return this.map.has(key);
  }

  public delete(key: string): boolean {
    return this.map.delete(key);
  }

  public clear(): void {
    this.map.clear();
  }
}

class SimpleStructDB<T extends Record<string, SerializableDB>>
  extends ObjectDB
  implements StructDB<T>
{
  public facade: Struct<Record<string, Serializable>> | undefined;
  constructor(
    private database: SimpleFutureDatabaseImpl,
    private dbInstanceId: number,
    private obj: T
  ) {
    super();
  }

  public getObjectType(): ObjectDBType.Struct {
    return ObjectDBType.Struct;
  }

  public setFacade(facade: Struct<Record<string, Serializable>>): void {
    this.dbInstanceId = this.database.getInstanceId();
    this.facade = facade;
  }
  public getFacade(): Struct<Record<string, Serializable>> | undefined {
    if (this.dbInstanceId !== this.database.getInstanceId()) {
      return undefined;
    }
    return this.facade;
  }

  public has<U extends keyof T>(key: U): boolean {
    return Object.hasOwn(this.obj, key);
  }

  public get<U extends keyof T>(key: U): T[U] {
    return this.database.deserialize(this.obj[key]);
  }

  public set<U extends keyof T>(key: U, value: T[U]): void {
    this.obj[key] = value;
  }

  public ownKeys(): (keyof T & string)[] {
    return Object.keys(this.obj);
  }
}

class SimpleListDB<T extends SerializableDB[]>
  extends ObjectDB
  implements ListDB<T>
{
  private facade: List<Serializable[]> | undefined;

  constructor(
    private database: SimpleFutureDatabaseImpl,
    private dbInstanceId: number,
    private elements: T
  ) {
    super();
  }

  public setFacade(facade: List<Serializable[]>): void {
    this.dbInstanceId = this.database.getInstanceId();
    this.facade = facade;
  }
  public getFacade(): List<Serializable[]> | undefined {
    if (this.dbInstanceId !== this.database.getInstanceId()) {
      return undefined;
    }
    return this.facade;
  }

  public getObjectType(): ObjectDBType.List {
    return ObjectDBType.List;
  }

  public size(): number {
    return this.elements.length;
  }

  public at<U extends keyof T & number>(index: U): T[U] {
    return this.database.deserialize(this.elements.at(index));
  }

  public values(): IterableIterator<ListElement<T>> {
    return this.database.deserializeIter(this.elements.values()) as Generator<
      ListElement<T>
    >;
  }

  public push(elements: Iterable<ListElement<T>>): number {
    return this.elements.push(...elements);
  }

  public pop(): ListElement<T> | undefined {
    return this.database.deserialize(this.elements.pop()) as
      | ListElement<T>
      | undefined;
  }

  public set(elements: Iterable<ListElement<T>>, index: number): void {
    let i = index;
    for (const element of elements) {
      this.elements[i] = element;
      i++;
    }
  }
}

export class SimpleFutureDatabase implements FutureDatabase {
  private impl: SimpleFutureDatabaseImpl;

  constructor(state?: SimpleFutureDatabaseState) {
    this.impl = new SimpleFutureDatabaseImpl(state);
  }

  public [GetFutureDatabase](): SimpleFutureDatabaseImpl {
    return this.impl;
  }

  public flush(): Promise<void> {
    return this.impl.flush();
  }

  public close(): Promise<void> {
    return this.impl.close();
  }

  public getState(): SimpleFutureDatabaseState {
    return this.impl.getState();
  }
}

export class SimpleEntityDB<T extends Record<string, SerializableDB>>
  extends ObjectDB
  implements EntityDB<T>
{
  private facade: Entity<Record<string, Serializable>> | undefined;

  constructor(
    private database: SimpleFutureDatabaseImpl,
    private dbInstanceId: number,
    private name: string,
    private obj: T
  ) {
    super();
  }
  public setFacade(facade: Entity<Record<string, Serializable>>): void {
    this.dbInstanceId = this.database.getInstanceId();
    this.facade = facade;
  }
  public getFacade(): Entity<Record<string, Serializable>> | undefined {
    if (this.dbInstanceId !== this.database.getInstanceId()) {
      return undefined;
    }
    return this.facade;
  }

  public getObjectType(): ObjectDBType.Entity {
    return ObjectDBType.Entity;
  }

  public getName(): string {
    return this.name;
  }

  public get<U extends keyof T>(key: U): T[U] {
    return this.database.deserialize(this.obj[key]);
  }

  public set<U extends keyof T>(key: U, value: T[U]): void {
    this.obj[key] = value;
  }
}

class SimpleFutureDatabaseImpl extends FutureDatabaseImpl implements Database {
  private futureMap: FutureMap = new Map();
  private idCounter: number = 0;
  private futureMachineDBTools: FutureMachineDBTools | undefined;

  private unboundMethodMap = new Map<MethodName, MethodDB>();

  // TODO: This is just so that the Objects/Methods/Futures don't hold onto
  // their facade across sessions for testing. We should get rid of this once we
  // can actually serialize the state into a string.
  //
  // Increments whenever we close the database, so that it can be reused.
  private instanceId = 0;

  constructor(state?: SimpleFutureDatabaseState) {
    super();
    if (state) {
      this.futureMap = state.futureMap;
      this.idCounter = state.idCounter;
    }
  }

  public setFutureMachineDBTools(
    futureMachineDBTools: FutureMachineDBTools
  ): void {
    this.futureMachineDBTools = futureMachineDBTools;
  }

  public flush(): Promise<void> {
    if (this.futureMachineDBTools === undefined) {
      return Promise.resolve();
    }
    return this.futureMachineDBTools.onActivitySettled();
  }

  public async close(): Promise<void> {
    await this.flush();
    this.instanceId++;
  }

  public getInstanceId() {
    return this.instanceId;
  }

  // TODO: Should add more tests for every where this is called. This function
  // is mostly a workaround so that an unbounded Method is always the same as
  // the one that was created at the start of the session. We should probably
  // just make this a JSON database.
  public deserialize<T extends SerializableDB>(value: T): T {
    if (value instanceof SimpleMethodDB && value.isUnbounded()) {
      const methodDb = this.unboundMethodMap.get(value.getName());
      if (methodDb !== undefined) {
        return methodDb as unknown as T;
      }
    }
    return value;
  }

  public *deserializeIter<T extends SerializableDB>(
    args: Iterable<T>
  ): Generator<T> {
    for (const arg of args) {
      yield this.deserialize(arg);
    }
  }

  private deserializeReactions(reactions: Reaction<SerializableDB>[]) {
    return reactions.map(({ nextFutureDb, methodDb }) => {
      return {
        nextFutureDb,
        methodDb: this.deserialize(methodDb),
      };
    });
  }

  public getFutureIds(): FutureId<Serializable>[] {
    return [...this.futureMap.keys()];
  }

  public getReactions<T extends Serializable>(
    futureId: FutureId<T>
  ): {
    fulfillReactions: Reaction<SerializableDB>[];
    rejectReactions: Reaction<SerializableDB>[];
  } {
    // TODO: You may want to call deserializeReactions here.
    return this.futureMap.get(futureId)!;
  }

  private getFutureReactions<T extends SerializableDB>(
    futureDb: FutureDB<T>
  ): FutureMapEntry {
    const futureReactions = this.futureMap.get(futureDb.getId());
    assert_defined(
      futureReactions,
      `Future with id ${futureDb.getId()} not found.`
    );
    return futureReactions;
  }

  public pushReactionsImpl<T extends SerializableDB, U extends SerializableDB>(
    currentFutureDb: FutureDB<T>,
    nextFutureDb: FutureDB<U>,
    onFulfilled?: MethodDB,
    onRejected?: MethodDB
  ) {
    const futureReactions = this.getFutureReactions(currentFutureDb);
    futureReactions.fulfillReactions.push({
      nextFutureDb,
      methodDb: onFulfilled,
    });
    futureReactions.rejectReactions.push({
      nextFutureDb,
      methodDb: onRejected,
    });
  }

  public takeFutureReactions<T extends SerializableDB>(
    futureDb: FutureDB<T>
  ): FutureMapEntry {
    const futureReactions = this.getFutureReactions(futureDb);
    this.futureMap.delete(futureDb.getId());
    futureReactions.fulfillReactions = this.deserializeReactions(
      futureReactions.fulfillReactions
    );
    futureReactions.rejectReactions = this.deserializeReactions(
      futureReactions.rejectReactions
    );
    return futureReactions;
  }

  public getState(): SimpleFutureDatabaseState {
    return { futureMap: this.futureMap, idCounter: this.idCounter };
  }

  private generateId<T extends Serializable>(): FutureId<T> {
    return `future-${this.idCounter++}` as FutureId<T>;
  }

  public createMethodDB(name: MethodName, type: MethodType): MethodDB {
    const methodDb = new SimpleMethodDB(this, this.instanceId, name, type, []);
    this.unboundMethodMap.set(name, methodDb);
    return methodDb;
  }

  public createFutureDB<T extends SerializableDB>(): FutureDB<T> {
    const id = this.generateId<FromSerializableDB<T>>();
    const futureDb = new SimpleFutureDB<T>(
      this,
      this.instanceId,
      /* id = */ id,
      /* result = */ undefined,
      /* reason = */ undefined,
      FutureState.Pending,
      /* alreadySettled = */ false
    );
    this.futureMap.set(id, {
      futureDb,
      fulfillReactions: [],
      rejectReactions: [],
    });
    return futureDb;
  }

  public createResolvedFutureDB<T extends SerializableDB>(
    result: T | undefined
  ): FutureDB<T> {
    return new SimpleFutureDB<T>(
      this,
      this.instanceId,
      /* id = */ undefined,
      result,
      /* reason = */ undefined,
      FutureState.Fulfilled,
      /* alreadySettled = */ true
    );
  }

  public createRejectedFutureDB<T extends SerializableDB>(
    reason: T | undefined
  ): FutureDB<T> {
    return new SimpleFutureDB<T>(
      this,
      this.instanceId,
      /* id = */ undefined,
      /* result = */ undefined,
      reason,
      FutureState.Rejected,
      /* alreadySettled = */ true
    );
  }

  public getFutureDB<T extends Serializable>(
    futureId: FutureId<T>
  ): FutureDB<ToSerializableDB<T>> | undefined {
    return this.futureMap.get(futureId)?.futureDb;
  }

  public createAggregateDB<T extends SerializableDB>(): AggregateDB<T> {
    return new SimpleAggregateDB<T>(this, this.instanceId);
  }

  public createDictionaryDB<T extends SerializableDB>(): DictionaryDB<T> {
    return new SimpleDictionaryDB(this, this.instanceId);
  }

  public createStructDB<T extends Record<string, SerializableDB>>(
    obj: T
  ): StructDB<T> {
    // Shallow copy the obj so that the caller can't modify it later.
    return new SimpleStructDB(this, this.instanceId, { ...obj });
  }

  public createListDB<T extends SerializableDB[]>(elements: T): ListDB<T> {
    return new SimpleListDB(this, this.instanceId, elements);
  }

  public createEntityDB<T extends Record<string, SerializableDB>>(
    entityName: string,
    obj: T
  ): EntityDB<T> {
    // Shallow copy the obj so that the caller can't modify it later.
    return new SimpleEntityDB(this, this.instanceId, entityName, { ...obj });
  }
}
