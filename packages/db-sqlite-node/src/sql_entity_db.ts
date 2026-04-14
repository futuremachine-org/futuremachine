import type {
  Entity,
  EntityDB,
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

type SerializedType = {
  name: string;
  obj: [key: string, value: { valueType: ValueType; value: string }][];
};

export class SQLEntityDB<T extends Record<string, SerializableDB>>
  extends SQLObjectDB
  implements EntityDB<T>
{
  private facade: Entity<Record<string, Serializable>> | undefined;

  constructor(
    database: SQLFutureDatabaseImpl,
    objectId: ObjectIdDb | undefined,
    private name: string,
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
    for (const [_, { valueType, value }] of valueJson.obj) {
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
    value: SerializedType
  ) {
    const entity = new SQLEntityDB<T>(database, objectId, value.name, {} as T);
    weakCache.set(objectId, entity);
    entity.obj = Object.fromEntries(
      value.obj.map(([key, value]) => {
        return [key, database.fromInternalValue(value.valueType, value.value)];
      })
    ) as T;
    return entity;
  }

  public getObjectType(): ObjectDBType.Entity {
    return ObjectDBType.Entity;
  }

  public setFacade(facade: Entity<Record<string, Serializable>>): void {
    this.facade = facade;
  }
  public getFacade(): Entity<Record<string, Serializable>> | undefined {
    return this.facade;
  }

  public serialize(): SerializedType {
    return {
      obj: Object.entries(this.obj).map(([key, value]) => {
        return [key, this.toInternalValue(value)];
      }),
      name: this.name,
    };
  }

  public getName(): string {
    return this.name;
  }

  public get<U extends keyof T>(key: U): T[U] {
    return this.obj[key];
  }

  public set<U extends keyof T>(key: U, value: T[U]): void {
    this.obj[key] = value;
    this.setDirty();
  }
}
