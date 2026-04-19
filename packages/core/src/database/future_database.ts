import type { Dictionary } from '../containers/dictionary.js';
import type { Entity } from '../containers/entity.js';
import type { List } from '../containers/list.js';
import type { Struct } from '../containers/struct.js';
import type { Future, FutureId } from '../core/future.js';
import type { Method } from '../core/method.js';
import type { AnyMethodImpl, MethodName } from '../core/method_impl.js';
import { GetFutureDatabase } from '../symbols.js';
import type { FutureMachineDBTools } from './future_machine_db_tools.js';
import type { SerializableObject } from './serializable_object.js';

export { GetFutureDatabase } from '../symbols.js';
export { FutureMachineDBTools } from './future_machine_db_tools.js';

export enum FutureState {
  Pending,
  Fulfilled,
  Rejected,
}

export enum ObjectDBType {
  Aggregate,
  Dictionary,
  Struct,
  List,
  Entity,
  Method,
  Future,
}

export type Serializable =
  | void
  | null
  | boolean
  | number
  | bigint
  | string
  | undefined
  | SerializableObject;

export type SerializableDB =
  | void
  | null
  | boolean
  | number
  | bigint
  | string
  | undefined
  | ObjectDB;

export type ToSerializableDB<T extends Serializable> =
  // TODO: Explicitly go through each type of SerializableObject and map it here
  // and in `FromSerializableDB`.
  T extends SerializableObject ? ObjectDB : T;

export type FromSerializableDB<T extends SerializableDB> = T extends ObjectDB
  ? SerializableObject
  : T;

// Needed so that implementers have to extend ObjectDB.
const ObjectDBBranding = Symbol();
export abstract class ObjectDB {
  public [ObjectDBBranding]: undefined;
  public abstract getObjectType(): ObjectDBType;
}

export type Reaction<T extends SerializableDB> = {
  nextFutureDb: FutureDB<T>;
  methodDb: MethodDB | undefined;
};

export interface FutureDB<T extends SerializableDB> extends ObjectDB {
  getObjectType(): ObjectDBType.Future;

  setFacade(facade: Future<FromSerializableDB<T>>): void;
  getFacade(): Future<FromSerializableDB<T>> | undefined;

  getId(): FutureId<FromSerializableDB<T>>;

  getResult(): T | undefined;

  getReason(): SerializableDB | undefined;

  getState(): FutureState;

  // TODO: Can this be a state of FutureState? Like
  // `FutureState.ResolvedWithFuture`. The only thing would be properly checking
  // for it.
  getAlreadySettled(): boolean;

  // Returns whether `other` is same FutureDB as `this`.
  equals(other: FutureDB<T>): boolean;

  // Adds the `fulfillId` and `rejectId` to the reactions of `futureId`. Returns
  // a new `FutureId` that is resolved with the resolution of the Reaction.
  pushReactions<U extends SerializableDB>(
    onFulfilled?: MethodDB,
    onRejected?: MethodDB
  ): FutureDB<U>;

  // Adds empty reactions to the reactions of `currentFutureId`.`nextFutureId`
  // is the `FutureId` that is resolved with the resolution of the Reaction.
  pushReactionsWithFuture<U extends SerializableDB>(
    nextFutureDb: FutureDB<U>
  ): void;

  // Sets `futureDb`'s state to FutureState.Fulfilled, sets its result to
  // `result`, and yields the fulfill reactions of `futureDb`.
  fulfill(result: T): Iterable<Reaction<SerializableDB>>;

  // Sets `futureDb`'s state to FutureState.Rejected, sets its reason to
  // `reason`, and yields the reject reactions of `futureDb`.
  reject(reason: SerializableDB): Iterable<Reaction<SerializableDB>>;

  // Sets `futureDb`'s alreadySettled to true.
  settle(): void;

  // TODO: I think I want to get rid of these functions eventually, and instead
  // use a `WeakCache` to keep track of the promise with resolvers.

  // Returns the PromiseWithResolvers set by setPromiseWithResolvers. Used for
  // Future's getPromise().
  getPromiseWithResolvers():
    | Partial<PromiseWithResolvers<FromSerializableDB<T>>>
    | undefined;

  // Sets the PromiseWithResolvers returned by setPromiseWithResolvers. Used for
  // Future's getPromise().
  setPromiseWithResolvers(
    promiseWithResolvers:
      | Partial<PromiseWithResolvers<FromSerializableDB<T>>>
      | undefined
  ): void;
}

export enum MethodType {
  External,
  Internal,
}

export interface MethodDB extends ObjectDB {
  getObjectType(): ObjectDBType.Method;

  setFacade(facade: Method<AnyMethodImpl>): void;
  getFacade(): Method<AnyMethodImpl> | undefined;

  getName(): MethodName;

  getType(): MethodType;

  getBounded(): Iterable<SerializableDB>;

  pushBounded(args: Iterable<SerializableDB>): MethodDB;
}

export interface AggregateDB<T extends SerializableDB> extends ObjectDB {
  getObjectType(): ObjectDBType.Aggregate;

  setElementCount(count: number): void;
  // Settles the value at `index` to `value`. If all indices have a value, it
  // returns their values. Otherwise, returns undefined.
  settleElement<U extends T>(index: number, value: U): ListDB<T[]> | undefined;
}

export interface DictionaryDB<T extends SerializableDB> extends ObjectDB {
  getObjectType(): ObjectDBType.Dictionary;

  setFacade(facade: Dictionary<Serializable>): void;
  getFacade(): Dictionary<Serializable> | undefined;

  get(key: string): T | undefined;
  set(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
}

export interface StructDB<
  T extends Record<string, SerializableDB>,
> extends ObjectDB {
  getObjectType(): ObjectDBType.Struct;

  setFacade(facade: Struct<Record<string, Serializable>>): void;
  getFacade(): Struct<Record<string, Serializable>> | undefined;

  has<U extends keyof T>(key: U): boolean;
  get<U extends keyof T>(key: U): T[U];
  set<U extends keyof T>(key: U, value: T[U]): void;
  ownKeys(): (keyof T & string)[];
}

export type ListElement<T extends unknown[]> = T extends (infer U)[]
  ? U
  : never;

export interface ListDB<T extends SerializableDB[]> extends ObjectDB {
  getObjectType(): ObjectDBType.List;

  setFacade(facade: List<Serializable[]>): void;
  getFacade(): List<Serializable[]> | undefined;

  size(): number;
  at<U extends keyof T & number>(index: U): T[U];
  values(): IterableIterator<ListElement<T>>;
  push(elements: Iterable<ListElement<T>>): number;
  pop(): ListElement<T> | undefined;
  set(elements: Iterable<ListElement<T>>, index: number): void;
}

export interface EntityDB<
  T extends Record<string, SerializableDB>,
> extends ObjectDB {
  getObjectType(): ObjectDBType.Entity;

  setFacade(facade: Entity<Record<string, Serializable>>): void;
  getFacade(): Entity<Record<string, Serializable>> | undefined;

  getName(): string;
  get<U extends keyof T>(key: U): T[U];
  set<U extends keyof T>(key: U, value: T[U]): void;
}

export abstract class FutureDatabaseImpl {
  // Sets the FutureMachineDBTools which gives access to tools for Future
  public abstract setFutureMachineDBTools(
    futureMachineDBTools: FutureMachineDBTools
  ): void;

  // Returns a new `MethodDB`.
  public abstract createMethodDB(name: MethodName, type: MethodType): MethodDB;

  // Returns a new Pending `FutureDB`.
  public abstract createFutureDB<T extends SerializableDB>(): FutureDB<T>;

  // Returns a `FutureDB` that's already resolved with `reason`. This doesn't
  // need to be written to the database unless bound to a `Method`.
  public abstract createResolvedFutureDB<T extends SerializableDB>(
    result: T | undefined
  ): FutureDB<T>;

  // Returns a `FutureDB` that's already rejected with `reason`. This doesn't
  // need to be written to the database unless bound to a `Method`.
  public abstract createRejectedFutureDB<T extends SerializableDB>(
    reason: T | undefined
  ): FutureDB<T>;

  // Returns the a Pending `FutureDB` with the given `futureId`. If there is no
  // `FutureDB` with the given `futureId` or if the `FutureDB` with the given
  // `futureId` is not Pending, returns undefined.
  public abstract getFutureDB<T extends Serializable>(
    futureId: FutureId<T>
  ): FutureDB<ToSerializableDB<T>> | undefined;

  public abstract createAggregateDB<T extends SerializableDB>(): AggregateDB<T>;

  public abstract createDictionaryDB<
    T extends SerializableDB,
  >(): DictionaryDB<T>;

  public abstract createStructDB<T extends Record<string, SerializableDB>>(
    obj: T
  ): StructDB<T>;

  public abstract createListDB<T extends SerializableDB[]>(
    elements: T
  ): ListDB<T>;

  public abstract createEntityDB<T extends Record<string, SerializableDB>>(
    entityName: string,
    obj: T
  ): EntityDB<T>;
}

// TODO: Should this be a class? Or should FutureDatabaseImpl be an interface?
// Not that they have to be the same.
export interface FutureDatabase {
  [GetFutureDatabase](): FutureDatabaseImpl;
}
