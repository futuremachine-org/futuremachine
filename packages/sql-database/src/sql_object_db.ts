import {
  ObjectDB,
  ObjectDBType,
  type SerializableDB,
} from '@futuremachine/core';
import {
  assert_defined,
  assert_equal,
  assert_true,
  assert_unreached,
} from './asserts.js';
import { SQLObjectType, type ObjectIdDb } from './sql_database_intf.js';
import type {
  PendingWrite,
  SQLFutureDatabaseImpl,
} from './sql_future_database_impl.js';

enum DirtyState {
  None,
  Deleted,
  Changed,
}

export abstract class SQLObjectDB extends ObjectDB implements PendingWrite {
  private dirtyState: DirtyState = DirtyState.None;
  // TODO: We should pass in this value so that its set to the current
  // garbageCollectionCount when this is deserialized from the db.
  private garbageCollectionCount: number = -1;

  constructor(
    protected database: SQLFutureDatabaseImpl,
    private objectId: ObjectIdDb | undefined
  ) {
    super();
  }

  public abstract serialize(): unknown;

  private toSQLObjectDBType(objectDbType: ObjectDBType): SQLObjectType {
    switch (objectDbType) {
      case ObjectDBType.Aggregate:
        return SQLObjectType.Aggregate;
      case ObjectDBType.Dictionary:
        return SQLObjectType.Dictionary;
      case ObjectDBType.Entity:
        return SQLObjectType.Entity;
      case ObjectDBType.List:
        return SQLObjectType.List;
      case ObjectDBType.Struct:
        return SQLObjectType.Struct;
      /* c8 ignore next 3 */
      case ObjectDBType.Method:
      case ObjectDBType.Future:
        assert_unreached('Not a SQLObjectDB');
    }
  }

  protected setDirty() {
    if (this.objectId !== undefined && this.dirtyState === DirtyState.None) {
      this.dirtyState = DirtyState.Changed;
      this.database.pushPendingWrite(this);
    }
  }

  public deleteFromDB() {
    if (this.objectId !== undefined) {
      // This is only called from SQLAggregateDB.settleElement after a call to
      // setDirty.
      assert_equal(
        this.dirtyState,
        DirtyState.Changed,
        'Should only be called after setDirty()'
      );
      this.dirtyState = DirtyState.Deleted;
    }
  }

  protected toInternalValue(obj: SerializableDB) {
    return this.database.toInternalValue(obj);
  }

  public write() {
    assert_true(
      this.database.isInFlush(),
      'Should only be called during a flush.'
    );
    assert_defined(
      this.objectId,
      'Should only write if we already have an object id'
    );
    switch (this.dirtyState) {
      case DirtyState.Changed:
        this.database.updateObjectDb(this.objectId, this.serialize());
        break;
      case DirtyState.Deleted:
        this.database.deleteObjectDb(this.objectId);
        break;
      /* c8 ignore next 2 */
      case DirtyState.None:
        assert_unreached("Write shouldn't write if our dirtyState is none");
    }
    this.dirtyState = DirtyState.None;
  }

  public getOrCreateId(): ObjectIdDb {
    assert_true(
      this.database.isInFlush(),
      'Should only be called during a flush.'
    );
    if (this.objectId !== undefined) {
      if (
        this.garbageCollectionCount == this.database.getGarbageCollectionCount()
      ) {
        return this.objectId;
      }
      // If a garbage collection has happened since the last time we checked, we
      // may not be written to disk anymore. Check if we are and if we're not
      // rewrite ourselves to disk.
      if (this.database.objectsHasId(this.objectId)) {
        return this.objectId;
      }
    }
    this.garbageCollectionCount = this.database.getGarbageCollectionCount();
    this.objectId = this.database.getNextObjectId();

    this.database.createObjectDBWithValue(
      this.objectId,
      this.toSQLObjectDBType(this.getObjectType()),
      this,
      this.serialize()
    );

    return this.objectId;
  }
}
