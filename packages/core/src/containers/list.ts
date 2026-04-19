import type { Method } from '../core/method.js';
import type { ListElement, Serializable } from '../database/future_database.js';
import type { SerializableObject } from '../database/serializable_object.js';
import {
  ListCreate,
  ListGetImpl,
  SerializableObjectBranding,
} from '../symbols.js';
import type { ListImpl } from './list_impl.js';

export class List<T extends Serializable[]> implements SerializableObject {
  public [SerializableObjectBranding] = undefined;

  private constructor(private impl: ListImpl<T>) {}

  public static [ListCreate]<T extends Serializable[]>(
    impl: ListImpl<T>
  ): List<T> {
    return new List<T>(impl);
  }

  public [ListGetImpl](): ListImpl<T> {
    return this.impl;
  }

  public get length(): number {
    return this.impl.size();
  }

  public [Symbol.iterator](): IterableIterator<ListElement<T>> {
    return this.impl.values();
  }

  public size(): number {
    return this.impl.size();
  }

  public at<U extends keyof T & number>(index: U): T[U] {
    return this.impl.at(index);
  }

  public values(): IterableIterator<ListElement<T>> {
    return this.impl.values();
  }

  public push(...elements: ListElement<T>[]): number {
    return this.impl.push(elements);
  }

  public pop(): ListElement<T> | undefined {
    return this.impl.pop();
  }

  public set(elements: ListElement<T>[], index: number) {
    this.impl.set(elements, index);
  }

  // TODO: Add thisArg parameter once Method supports it.
  public map<U extends Serializable>(
    callback:
      | ((element: ListElement<T>, index: number, list: List<T>) => U)
      | Method<(element: ListElement<T>, index: number, list: List<T>) => U>
  ): List<U[]> {
    return this.impl.map(callback, this);
  }

  // TODO: Add other methods that Array has.
}
