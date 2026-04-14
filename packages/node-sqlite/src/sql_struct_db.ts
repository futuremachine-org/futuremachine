import type {
  ObjectDB,
  Serializable,
  SerializableDB,
  Struct,
  StructDB,
} from '@futuremachine/core';
import { ObjectDBType } from '@futuremachine/core';
import {
  ValueType,
  type FutureIdDb,
  type MethodIdDb,
  type ObjectIdDb,
} from './sql_database_intf.js';
import { type SQLFutureDatabaseImpl } from './sql_future_database_impl.js';
import { SQLObjectDB } from './sql_object_db.js';
import type { WeakCache } from './weak_cache.js';

type SerializedType = [
  key: string,
  value: { valueType: ValueType; value: string },
][];

export class SQLStructDB<T extends Record<string, SerializableDB>>
  extends SQLObjectDB
  implements StructDB<T>
{
  private facade: Struct<Record<string, Serializable>> | undefined;

  constructor(
    database: SQLFutureDatabaseImpl,
    objectId: ObjectIdDb | undefined,
    private obj: T
  ) {
    super(database, objectId);
  }

  public static GetIds(
    futureSet: FutureIdDb[],
    methodsSet: MethodIdDb[],
    objectsSet: ObjectIdDb[],
    valueJson: SerializedType
  ) {
    for (const [_, { valueType, value }] of valueJson) {
      switch (valueType) {
        case ValueType.Method:
          methodsSet.push(Number(value));
          break;
        case ValueType.Obj:
          objectsSet.push(Number(value));
          break;
        case ValueType.Future:
          futureSet.push(value);
          break;
        default:
          break;
      }
    }
  }

  public static Deserialize<T extends Record<string, SerializableDB>>(
    database: SQLFutureDatabaseImpl,
    weakCache: WeakCache<ObjectIdDb, ObjectDB>,
    objectId: ObjectIdDb,
    serializedObj: SerializedType
  ) {
    const struct = new SQLStructDB<T>(database, objectId, {} as T);
    weakCache.set(objectId, struct);
    struct.obj = Object.fromEntries(
      serializedObj.map(([key, value]) => {
        return [key, database.fromInternalValue(value.valueType, value.value)];
      })
    ) as T;
    return struct;
  }

  public getObjectType(): ObjectDBType.Struct {
    return ObjectDBType.Struct;
  }

  public setFacade(facade: Struct<Record<string, Serializable>>): void {
    this.facade = facade;
  }
  public getFacade(): Struct<Record<string, Serializable>> | undefined {
    return this.facade;
  }

  public serialize(): SerializedType {
    return Object.entries(this.obj).map(([key, value]) => {
      return [key, this.toInternalValue(value)];
    });
  }

  public has<U extends keyof T>(key: U): boolean {
    return Object.hasOwn(this.obj, key);
  }

  public get<U extends keyof T>(key: U): T[U] {
    return this.obj[key];
  }

  public set<U extends keyof T>(key: U, value: T[U]): void {
    this.obj[key] = value;
    this.setDirty();
  }

  public ownKeys(): (keyof T & string)[] {
    return Object.keys(this.obj);
  }
}
