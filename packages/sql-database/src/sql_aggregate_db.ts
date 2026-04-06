import {
  ObjectDBType,
  type AggregateDB,
  type ListDB,
  type ObjectDB,
  type SerializableDB,
} from '@futuremachine/core';
import { assert_defined, assert_less_than } from './asserts.js';
import {
  type FutureIdDb,
  type MethodIdDb,
  type ObjectIdDb,
} from './sql_database_intf.js';
import type { SQLFutureDatabaseImpl } from './sql_future_database_impl.js';
import type { SQLListDB } from './sql_list_db.js';
import { SQLObjectDB } from './sql_object_db.js';
import type { WeakCache } from './weak_cache.js';

type SerializedType = {
  // TODO: Add tests for Methods and Futures. I believe they will pass but good
  // to have coverage. Also Futures probably can't be held in an aggregate
  // anyways since they will be unwrapped.
  list: ObjectIdDb;
  remainingElementCount: number;
};

export class SQLAggregateDB<T extends SerializableDB>
  extends SQLObjectDB
  implements AggregateDB<T>
{
  constructor(
    database: SQLFutureDatabaseImpl,
    objectId: ObjectIdDb | undefined = undefined,
    private values: SQLListDB<T[]> | undefined = undefined,
    private remainingElementCount: number = 0
  ) {
    super(database, objectId);
  }

  public static GetIds(
    _futureSet: FutureIdDb[],
    _methodsSet: MethodIdDb[],
    objectsSet: ObjectIdDb[],
    value: SerializedType
  ) {
    objectsSet.push(value.list);
  }

  public static Deserialize<T extends SerializableDB>(
    database: SQLFutureDatabaseImpl,
    weakCache: WeakCache<ObjectIdDb, ObjectDB>,
    objectId: ObjectIdDb,
    value: SerializedType
  ): SQLAggregateDB<T> {
    const aggregateDb = new SQLAggregateDB<T>(
      database,
      objectId,
      database.getObjectDb(value.list) as SQLListDB<T[]>,
      value.remainingElementCount
    );
    weakCache.set(objectId, aggregateDb);
    return aggregateDb;
  }

  public getObjectType(): ObjectDBType.Aggregate {
    return ObjectDBType.Aggregate;
  }

  public serialize(): SerializedType {
    return {
      // TODO: Is it possible for values to be undefined here? If not we should
      // assert that they can't.
      list: this.values!.getOrCreateId(),
      remainingElementCount: this.getRemainingElementCount(),
    };
  }

  public setElementCount(count: number): void {
    this.values = this.database.createListDB(new Array(count).fill(undefined));
    this.remainingElementCount = count;
    this.setDirty();
  }

  // Sets the resolution value at `index` to `value`. If all indices have a
  // resolution value, it returns their values. Otherwise, returns undefined.
  public settleElement<U extends T>(
    index: number,
    value: U
  ): ListDB<T[]> | undefined {
    const values = this.values;
    assert_defined(
      values,
      'resolveElement should never be called before `setElementCount` has been called'
    );
    assert_less_than(index, values.size(), 'index is out of range');

    values.set([value], index);
    this.remainingElementCount--;
    this.setDirty();
    if (this.remainingElementCount === 0) {
      this.deleteFromDB();
      this.values = undefined;
      return values;
    }
  }

  public getRemainingElementCount(): number {
    return this.remainingElementCount;
  }
}
