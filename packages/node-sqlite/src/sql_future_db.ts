import type {
  FromSerializableDB,
  Future,
  FutureDB,
  FutureId,
  Reaction,
  SerializableDB,
} from '@futuremachine/core';
import { FutureState, ObjectDB, ObjectDBType } from '@futuremachine/core';
import { assert_defined, assert_true } from './asserts.js';
import type { FutureIdDb } from './sql_database_intf.js';
import type {
  PendingWrite,
  SQLFutureDatabaseImpl,
} from './sql_future_database_impl.js';
import type { SQLMethodDB } from './sql_method_db.js';

class SQLReactionsDB implements PendingWrite {
  private dirty = false;
  private deleted = false;
  private writtenFulfillReactions: Reaction<SerializableDB>[] = [];
  private unwrittenFulfillReactions: Reaction<SerializableDB>[] = [];

  constructor(
    // TODO: There's ways to not do this such as adding a WeakCache for
    // SQLReactionsDBs or by not making SQLReactionDB a PendingWrite and instead
    // have it be written through SQLFutureDB. But the current solution is a
    // very simple fix. Although potentially it could be optimized out by some
    // tool like a minifier.
    //
    // Only here so that `_futureDb` isn't garbage collected before its parent.
    private _futureDb: SQLFutureDB<SerializableDB>,
    private database: SQLFutureDatabaseImpl,
    private internalId: FutureIdDb,
    // Whether we have all reactions in memory.
    private read: boolean,
    private state: FutureState
  ) {}

  private setDirty() {
    if (this.internalId && !this.dirty) {
      this.dirty = true;
      this.database.pushPendingWrite(this);
    }
  }

  public write() {
    assert_defined(
      this.internalId,
      'Should only call write when internalId is defined'
    );
    this.dirty = false;

    if (this.deleted) {
      // TODO: Don't call if we started out with no reactions in the database.
      // So when this.writtenFulfillReactions.length > 1 && this.read.
      this.database.deleteReactions(this.state, this.internalId);
      return;
    }

    this.database.pushReactions(
      this.internalId,
      this.state,
      this.unwrittenFulfillReactions
    );

    // If we need to read reactions from the database, then we will end up
    // retrieving all the values from the database.
    if (this.read) {
      this.writtenFulfillReactions.push(...this.unwrittenFulfillReactions);
    }
    this.unwrittenFulfillReactions = [];
  }

  public delete() {
    this.deleted = true;
    this.writtenFulfillReactions = [];
    this.unwrittenFulfillReactions = [];
  }

  public push<U extends SerializableDB>(
    nextFutureDb: FutureDB<U>,
    methodDb?: SQLMethodDB
  ) {
    this.unwrittenFulfillReactions.push({
      nextFutureDb,
      methodDb,
    } as Reaction<SerializableDB>);
    this.setDirty();
  }

  public *pop(): Generator<Reaction<SerializableDB>> {
    if (this.read) {
      yield* this.writtenFulfillReactions;
    } else {
      assert_defined(
        this.internalId,
        'Should have an internal id if there are reactions in the db'
      );
      yield* this.database.getFutureReactions(this.internalId, this.state);
    }
    yield* this.unwrittenFulfillReactions;

    this.delete();
    this.setDirty();
  }
}

export class SQLFutureDB<T extends SerializableDB>
  extends ObjectDB
  implements FutureDB<T>, PendingWrite
{
  private facade: Future<FromSerializableDB<T>> | undefined;
  private promiseWithResolvers:
    | Partial<PromiseWithResolvers<FromSerializableDB<T>>>
    | undefined;

  private fulfillReactions: SQLReactionsDB;
  private rejectReactions: SQLReactionsDB;

  private dirty = false;

  private garbageCollectionCount: number = -1;

  constructor(
    private database: SQLFutureDatabaseImpl,
    private root: boolean,
    private inDatabase: boolean,
    private id: FutureId<FromSerializableDB<T>>,
    private internalId: FutureIdDb,
    private result: T | undefined,
    private reason: SerializableDB | undefined,
    private state: FutureState,
    private alreadySettled: boolean
  ) {
    super();
    this.fulfillReactions = new SQLReactionsDB(
      this as SQLFutureDB<SerializableDB>,
      database,
      internalId,
      !inDatabase,
      FutureState.Fulfilled
    );
    this.rejectReactions = new SQLReactionsDB(
      this as SQLFutureDB<SerializableDB>,
      database,
      internalId,
      !inDatabase,
      FutureState.Rejected
    );
  }

  public getObjectType(): ObjectDBType.Future {
    return ObjectDBType.Future;
  }

  public setFacade(facade: Future<FromSerializableDB<T>>): void {
    this.facade = facade;
  }

  public getFacade(): Future<FromSerializableDB<T>> | undefined {
    return this.facade;
  }

  private setDirty() {
    if (!this.dirty) {
      this.dirty = true;
      this.database.pushPendingWrite(this);
    }
  }

  private wasGarbageCollected() {
    return (
      this.garbageCollectionCount !==
        this.database.getGarbageCollectionCount() &&
      !this.database.futuresHasId(this.internalId!)
    );
  }

  public write() {
    assert_true(
      this.database.isInFlush(),
      'Should only be called during a flush.'
    );
    this.dirty = false;

    if (!this.inDatabase) {
      this.garbageCollectionCount = this.database.getGarbageCollectionCount();
      this.database.writeFutureDb(
        this,
        this.internalId,
        this.root,
        this.result,
        this.reason,
        this.state,
        this.alreadySettled
      );
      this.inDatabase = true;
      return;
    }
    switch (this.state) {
      case FutureState.Fulfilled:
        this.database.setFutureState(this.internalId, this.state, this.result);
        break;
      case FutureState.Rejected:
        this.database.setFutureState(this.internalId, this.state, this.reason);
        break;
      case FutureState.Pending:
        this.database.settleFutureDb(this.internalId);
        break;
    }
  }

  private ensureInDatabase() {
    if (!this.inDatabase || this.wasGarbageCollected()) {
      this.inDatabase = false;
      this.setDirty();
    }
  }

  public getInternalId() {
    assert_true(
      this.database.isInFlush(),
      'Should only be called during a flush.'
    );
    this.ensureInDatabase();
    return this.internalId;
  }

  public getId(): FutureId<FromSerializableDB<T>> {
    this.ensureInDatabase();
    return this.id;
  }

  public getResult(): T | undefined {
    return this.result;
  }

  public getReason(): SerializableDB | undefined {
    return this.reason;
  }

  public getState(): FutureState {
    return this.state;
  }

  public getAlreadySettled(): boolean {
    return this.alreadySettled;
  }

  public equals(other: SQLFutureDB<T>): boolean {
    return other === this;
  }

  private pushReactionsImpl<U extends SerializableDB>(
    nextFutureDb: FutureDB<U>,
    onFulfilled?: SQLMethodDB,
    onRejected?: SQLMethodDB
  ) {
    this.fulfillReactions.push(nextFutureDb, onFulfilled);
    this.rejectReactions.push(nextFutureDb, onRejected);
  }

  public pushReactions<U extends SerializableDB>(
    onFulfilled?: SQLMethodDB,
    onRejected?: SQLMethodDB
  ): FutureDB<U> {
    const nextFutureDb = this.database.createNextFutureDB<U>();
    this.pushReactionsImpl(nextFutureDb, onFulfilled, onRejected);
    return nextFutureDb;
  }

  public pushReactionsWithFuture<U extends SerializableDB>(
    nextFutureDb: FutureDB<U>
  ): void {
    this.pushReactionsImpl(nextFutureDb);
  }

  public *fulfill(result: T): Generator<Reaction<SerializableDB>> {
    this.state = FutureState.Fulfilled;
    this.result = result;
    this.alreadySettled = true;
    this.root = false;
    this.setDirty();
    this.rejectReactions.delete();
    yield* this.fulfillReactions.pop();
  }

  public *reject(reason: SerializableDB): Generator<Reaction<SerializableDB>> {
    this.state = FutureState.Rejected;
    this.reason = reason;
    this.alreadySettled = true;
    this.root = false;
    this.setDirty();
    this.fulfillReactions.delete();
    yield* this.rejectReactions.pop();
  }

  public settle(): void {
    this.alreadySettled = true;
    this.root = false;
    this.setDirty();
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
