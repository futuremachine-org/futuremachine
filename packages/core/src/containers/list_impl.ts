import type { FutureMachineImpl } from '../core/future_machine_impl.js';
import type { Method } from '../core/method.js';
import type {
  ListDB,
  ListElement,
  Serializable,
  SerializableDB,
  ToSerializableDB,
} from '../database/future_database.js';
import {
  deserialize,
  deserializeArgs,
  serializeArgs,
  type ToArrayDB,
} from '../database/serialize_utils.js';
import type { List } from './list.js';

export class ListImpl<T extends Serializable[]> {
  constructor(
    private futureMachine: FutureMachineImpl,
    private listDb: ListDB<ToArrayDB<T>>
  ) {}

  public getListDb() {
    return this.listDb;
  }

  public size(): number {
    return this.listDb.size();
  }

  public at<U extends keyof T & number>(index: U): T[U] {
    return deserialize(
      this.futureMachine,
      this.listDb.at(index) as ToSerializableDB<T[U]>
    );
  }

  public values(): IterableIterator<ListElement<T>> {
    // TODO: Add test for specifically deserializing the values here.
    return deserializeArgs(
      this.futureMachine,
      this.listDb.values() as Iterable<SerializableDB>
    ) as IterableIterator<ListElement<T>>;
  }

  public push(elements: ListElement<T>[]): number {
    // TODO: If we're going to push elements as they're being serialized then we
    // might need to use a Generator to prevent having a temporary array.
    return this.listDb.push(
      serializeArgs(elements) as Iterable<ListElement<ToArrayDB<T>>>
    );
  }

  public pop(): ListElement<T> | undefined {
    // TODO: Add test for specifically deserializing the values here.

    return deserialize(
      this.futureMachine,
      this.listDb.pop() as ToSerializableDB<ListElement<T> | undefined>
    );
  }

  public set(elements: ListElement<T>[], index: number) {
    this.listDb.set(
      serializeArgs(elements) as Iterable<ListElement<ToArrayDB<T>>>,
      index
    );
  }

  public map<U extends Serializable>(
    callback:
      | ((element: ListElement<T>, index: number, list: List<T>) => U)
      | Method<(element: ListElement<T>, index: number, list: List<T>) => U>,
    list: List<T>
  ): List<U[]> {
    const mappedList = this.futureMachine.createList<U[]>([]);
    const index = 0;
    for (const element of this.values()) {
      mappedList.push(callback(element, index, list));
    }
    return mappedList;
  }
}
