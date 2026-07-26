import type { Method } from '../core/method.js';
import type { ListElement, Serializable } from '../database/future_database.js';
import type { SerializableObject } from '../database/serializable_object.js';
import {
  ListCreate,
  ListGetImpl,
  SerializableObjectBranding,
} from '../symbols.js';
import type { ListImpl } from './list_impl.js';

/**
 * A container that stores and retrieves values by index.
 *
 * The {@link Serializable} equivalent of a vanilla JavaScript `Array`.
 *
 * @category Containers
 */
export class List<T extends Serializable[]> implements SerializableObject {
  /**
   * Brands this as a {@link SerializableObject}.
   * @hidden
   */
  public [SerializableObjectBranding] = undefined;

  private constructor(private impl: ListImpl<T>) {}

  /**
   * Creates a {@link List}.
   * @hidden
   */
  public static [ListCreate]<T extends Serializable[]>(
    impl: ListImpl<T>
  ): List<T> {
    return new List<T>(impl);
  }

  /**
   * Returns the {@link ListImpl} backing for the {@link List}.
   * @hidden
   */
  public [ListGetImpl](): ListImpl<T> {
    return this.impl;
  }

  /**
   * The number of elements in the {@link List}.
   *
   * An alias for {@link List.size | size()}.
   */
  public get length(): number {
    return this.impl.size();
  }

  /**
   * Returns the number of elements in the {@link List}.
   *
   * @returns The count of elements contained in the list.
   */
  public size(): number {
    return this.impl.size();
  }

  /**
   * Creates an iterator over the {@link List}'s elements.
   *
   * Enables the {@link List} to be iterable directly.
   *
   * @returns An iterator of the {@link List}'s elements.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const list = containers.list.create<string[]>('hello', 'world');
   *
   * for (const value of list) {
   *   console.log(value);
   * }
   * // Console output:
   * // hello
   * // world
   * ```
   */
  public [Symbol.iterator](): IterableIterator<ListElement<T>> {
    return this.impl.values();
  }

  /**
   * Retrieves the element at index `index`.
   *
   * Supports relative indexing from the end of the list using negative integers
   * (e.g., `-1` returns the last element).
   *
   * @param index - The zero-based index of the element to retrieve.
   * @returns The element at index `index`, or `undefined` if `index` is out of bounds.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const list = containers.list.create<[string, number]>('hello', 12);
   *
   * console.log(list.at(0));
   * console.log(list.at(-1));
   * console.log(list.at(5));
   * // Console output:
   * // hello
   * // 12
   * // undefined
   * ```
   */
  public at<U extends keyof T & number>(index: U): T[U] {
    return this.impl.at(index);
  }

  /**
   * Creates an iterator over the {@link List}'s elements.
   *
   * @returns An iterator of the {@link List}'s elements.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const list = containers.list.create<string[]>('hello', 'world');
   *
   * for (const value of list.values()) {
   *   console.log(value);
   * }
   * // Console output:
   * // hello
   * // world
   * ```
   */
  public values(): IterableIterator<ListElement<T>> {
    return this.impl.values();
  }

  // TODO: `elements` should be an Array or List.
  /**
   * Pushes `elements` to the end of the {@link List}.
   *
   * @param elements - The elements to push to the {@link List}.
   * @returns The new {@link length} of the {@link List}.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const list = containers.list.create<string[]>('hello', 'world');
   *
   * list.push('fizz', 'buzz');
   * // `list` now contains:
   * // 0: hello
   * // 1: world
   * // 2: fizz
   * // 3: buzz
   * ```
   */
  public push(...elements: ListElement<T>[]): number {
    return this.impl.push(elements);
  }

  /**
   * Pops the last element off the {@link List} and returns it.
   *
   * @returns The last element in the {@link List}.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const list = containers.list.create<string[]>('hello', 'world');
   *
   * console.log(list.pop());
   * // Console output:
   * // world
   * // `list` now contains:
   * // 0: hello
   * ```
   */
  public pop(): ListElement<T> | undefined {
    return this.impl.pop();
  }

  // TODO: `elements` should be an Array or List.
  //
  // TODO: I think we might want to remove this function in favor of directly
  // setting indices, i.e. `list[4] = 'hello'`. Would require using a Proxy
  // though.
  //
  // TODO: If we do want to keep this, we need to figure out if we want to
  // handle when index + elements.length is greater than the list size.
  /**
   * Sets multiple elements starting at `index` to the values in `elements`.
   *
   * @param elements - An array of values to write into the {@link List}.
   * @param index - The index to start writing the values to.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const list = containers.list.create<string[]>('hello', 'world', 'fizz');
   *
   * list.set(['lorem', 'ipsum'], 1);
   * // `list` now contains:
   * // 0: hello
   * // 1: lorem
   * // 2: ipsum
   * ```
   */
  public set(elements: ListElement<T>[], index: number) {
    this.impl.set(elements, index);
  }

  // TODO: Add thisArg parameter once Method supports it.
  /**
   * Creates a new {@link List} where each element is mapped from the original
   * {@link List}, transformed by `callback`.
   *
   * @param callback - The function or {@link Method} that maps the original
   * element to the new element.
   * @returns The resulting {@link List}.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const list = containers.list.create<string[]>('hello', 'world');
   *
   * const mappedList = list.map((str) => `${str}_mapped`);
   * // `mappedList` contains:
   * // 0: hello_mapped
   * // 1: world_mapped
   * ```
   */
  public map<U extends Serializable>(
    callback:
      | ((element: ListElement<T>, index: number, list: List<T>) => U)
      | Method<(element: ListElement<T>, index: number, list: List<T>) => U>
  ): List<U[]> {
    return this.impl.map(callback, this);
  }

  // TODO: Add other methods that Array has.
}
