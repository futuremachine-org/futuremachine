import type {
  Dictionary,
  DictionaryDB,
  ObjectDB,
  Serializable,
  SerializableDB,
} from '@futuremachine/core';
import { ObjectDBType } from '@futuremachine/core';
import {
  ValueType,
  type FutureIdDb,
  type MethodIdDb,
  type ObjectIdDb,
} from './sql_database_intf.js';
import type { SQLFutureDatabaseImpl } from './sql_future_database_impl.js';
import { SQLObjectDB } from './sql_object_db.js';
import type { WeakCache } from './weak_cache.js';

type SerializedType = [string, { valueType: ValueType; value: string }][];

export class SQLDictionaryDB<T extends SerializableDB>
  extends SQLObjectDB
  implements DictionaryDB<T>
{
  private facade: Dictionary<Serializable> | undefined;

  constructor(
    database: SQLFutureDatabaseImpl,
    objectId: ObjectIdDb | undefined,
    private map: Map<string, T> = new Map()
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

  public static Deserialize<T extends SerializableDB>(
    database: SQLFutureDatabaseImpl,
    weakCache: WeakCache<ObjectIdDb, ObjectDB>,
    objectId: ObjectIdDb,
    values: SerializedType
  ) {
    const dictionary = new SQLDictionaryDB<T>(database, objectId);
    weakCache.set(objectId, dictionary);
    values.forEach(([k, v]) => {
      dictionary.map.set(
        k,
        database.fromInternalValue(v.valueType, v.value) as T
      );
    });
    return dictionary;
  }

  public getObjectType(): ObjectDBType.Dictionary {
    return ObjectDBType.Dictionary;
  }

  public setFacade(facade: Dictionary<Serializable>): void {
    this.facade = facade;
  }
  public getFacade(): Dictionary<Serializable> | undefined {
    return this.facade;
  }

  public serialize(): SerializedType {
    return Array.from(this.map, ([k, v]) => {
      return [k, this.toInternalValue(v)];
    });
  }

  public get(key: string): T | undefined {
    return this.map.get(key);
  }

  public set(key: string, value: T): void {
    this.map.set(key, value);
    this.setDirty();
  }

  public has(key: string): boolean {
    return this.map.has(key);
  }

  public delete(key: string): boolean {
    this.setDirty();
    return this.map.delete(key);
  }

  public clear(): void {
    this.map.clear();
    this.setDirty();
  }
}
