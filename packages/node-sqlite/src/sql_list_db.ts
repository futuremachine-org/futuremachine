import {
  List,
  ObjectDBType,
  type ListDB,
  type ListElement,
  type ObjectDB,
  type Serializable,
  type SerializableDB,
} from '@futuremachine/core';
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
  valueType: ValueType;
  value: string;
}[];

export class SQLListDB<T extends SerializableDB[]>
  extends SQLObjectDB
  implements ListDB<T>
{
  private facade: List<Serializable[]> | undefined;

  constructor(
    database: SQLFutureDatabaseImpl,
    objectId: ObjectIdDb | undefined,
    private elements: T
  ) {
    super(database, objectId);
  }

  public static GetIds(
    futureSet: FutureIdDb[],
    methodsSet: MethodIdDb[],
    objectsSet: ObjectIdDb[],
    valueJson: SerializedType
  ) {
    for (const { valueType, value } of valueJson) {
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

  public static Deserialize<T extends SerializableDB[]>(
    database: SQLFutureDatabaseImpl,
    weakCache: WeakCache<ObjectIdDb, ObjectDB>,
    objectId: ObjectIdDb,
    elements: SerializedType
  ) {
    const list = new SQLListDB<T>(database, objectId, [] as unknown as T);
    weakCache.set(objectId, list);
    list.elements = elements.map((element) =>
      database.fromInternalValue(element.valueType, element.value)
    ) as T;
    return list;
  }

  public getObjectType(): ObjectDBType.List {
    return ObjectDBType.List;
  }

  public setFacade(facade: List<Serializable[]>): void {
    this.facade = facade;
  }
  public getFacade(): List<Serializable[]> | undefined {
    return this.facade;
  }

  public serialize(): SerializedType {
    return this.elements.map((element) => this.toInternalValue(element));
  }

  public size(): number {
    return this.elements.length;
  }

  public at<U extends keyof T & number>(index: U): T[U] {
    return this.elements.at(index);
  }

  public values(): IterableIterator<ListElement<T>> {
    return this.elements.values() as IterableIterator<ListElement<T>>;
  }

  public push(elements: Iterable<ListElement<T>>): number {
    this.setDirty();
    return this.elements.push(...elements);
  }

  public pop(): ListElement<T> | undefined {
    this.setDirty();
    return this.elements.pop() as ListElement<T> | undefined;
  }

  public set(elements: Iterable<ListElement<T>>, index: number): void {
    this.setDirty();
    let i = index;
    for (const element of elements) {
      this.elements[i] = element;
      i++;
    }
  }
}
