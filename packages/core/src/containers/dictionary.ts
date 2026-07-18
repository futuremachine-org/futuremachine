import type { Method } from '../core/method.js';
import type { Serializable } from '../database/future_database.js';
import type { SerializableObject } from '../database/serializable_object.js';
import {
  DictionaryCreate,
  DictionaryGetImpl,
  SerializableObjectBranding,
} from '../symbols.js';
import type { DictionaryImpl } from './dictionary_impl.js';

// TODO: Should we support having Keys of any serializable type?

/**
 * A container that stores and retrieves values by key.
 *
 * The {@link Serializable} equivalent of a vanilla JavaScript `Map`.
 *
 * @category Containers
 */
export class Dictionary<T extends Serializable> implements SerializableObject {
  /**
   * Brands this as a {@link SerializableObject}.
   * @hidden
   */
  public [SerializableObjectBranding] = undefined;

  private constructor(private impl: DictionaryImpl<T>) {}

  /**
   * Creates a {@link Dictionary}.
   * @hidden
   */
  public static [DictionaryCreate]<T extends Serializable>(
    impl: DictionaryImpl<T>
  ): Dictionary<T> {
    return new Dictionary<T>(impl);
  }

  /**
   * Returns the {@link DictionaryImpl} backing for this {@link Dictionary}.
   * @hidden
   */
  public [DictionaryGetImpl](): DictionaryImpl<T> {
    return this.impl;
  }

  /**
   * The number of elements in the {@link Dictionary}.
   */
  public get size(): number {
    return this.impl.size();
  }

  /**
   * Creates an iterator over the {@link Dictionary}'s key-value pairs.
   *
   * Enables the {@link Dictionary} to be iterable directly.
   *
   * @returns An iterator of the {@link Dictionary}'s key-value pairs.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const dictionary = containers.dictionary.create<number>([
   *   ['hello', 1],
   *   ['world', 2],
   * ]);
   *
   * for (const [key, value] of dictionary) {
   *   console.log(key, value);
   * }
   * // Console output:
   * // hello 1
   * // world 2
   * ```
   */
  public [Symbol.iterator](): IteratorObject<[string, T]> {
    return this.entries();
  }

  /**
   * Creates an iterator over the {@link Dictionary}'s key-value pairs.
   *
   * @returns An iterator of the {@link Dictionary}'s key-value pairs.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const dictionary = containers.dictionary.create<number>([
   *   ['hello', 1],
   *   ['world', 2],
   * ]);
   *
   * for (const [key, value] of dictionary.entries()) {
   *   console.log(key, value);
   * }
   * // Console output:
   * // hello 1
   * // world 2
   * ```
   */
  public entries(): IteratorObject<[string, T]> {
    return this.impl.entries();
  }

  /**
   * Creates an iterator over the {@link Dictionary}'s keys.
   *
   * @returns An iterator of the {@link Dictionary}'s keys.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const dictionary = containers.dictionary.create<number>([
   *   ['hello', 1],
   *   ['world', 2],
   * ]);
   *
   * for (const key of dictionary.keys()) {
   *   console.log(key);
   * }
   * // Console output:
   * // hello
   * // world
   * ```
   */
  public keys(): IteratorObject<string> {
    return this.impl.keys();
  }

  /**
   * Creates an iterator over the {@link Dictionary}'s values.
   *
   * @returns An iterator of the {@link Dictionary}'s values.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const dictionary = containers.dictionary.create<number>([
   *   ['hello', 1],
   *   ['world', 2],
   * ]);
   *
   * for (const value of dictionary.values()) {
   *   console.log(value);
   * }
   * // Console output:
   * // 1
   * // 2
   * ```
   */
  public values(): IteratorObject<T> {
    return this.impl.values();
  }

  /**
   * Gets the value of the entry whose key is `key`.
   *
   * @param key - The key of the entry whose value we're retrieving.
   * @returns The value of the entry with key `key` or undefined if no entry has
   * key `key`.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const dictionary = containers.dictionary.create<number>([
   *   ['hello', 1],
   *   ['world', 2],
   * ]);
   *
   * console.log(dictionary.get('world'));
   * console.log(dictionary.get('fizz'));
   * // Console output:
   * // 2
   * // undefined
   * ```
   */
  public get(key: string): T | undefined {
    return this.impl.get(key);
  }

  /**
   * Gets or inserts the value of the entry whose key is `key`. If no entry with
   * `key` exists, then an entry is inserted with `key` and value `value` first
   * before returning its value.
   *
   * @param key - The key of the entry whose value we're returning.
   * @param value - The value to insert in the case that an entry with key `key`
   * doesn't already exist.
   * @returns The value of the existing or newly inserted entry with key `key`.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const dictionary = containers.dictionary.create<number>([
   *   ['hello', 1],
   *   ['world', 2],
   * ]);
   *
   * console.log(dictionary.getOrInsert('world', 3));
   * console.log(dictionary.getOrInsert('fizz', 4));
   * // Console output:
   * // 2
   * // 4
   * ```
   */
  public getOrInsert(key: string, value: T): T {
    if (this.has(key)) {
      return this.get(key)!;
    }
    this.set(key, value);
    return value;
  }

  /**
   * Gets or inserts the value of the entry whose key is `key`. If no entry with
   * `key` exists, then an entry is inserted with key `key` and a value computed
   * by `callback` before returning its value.
   *
   * @param key - The key of the entry whose value we're returning.
   * @param callback - Computes the value of the entry in the case that no entry
   * with `key` key exists. `key` is passed as an argument.
   * @returns The value of the existing or newly inserted entry with key `key`.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const dictionary = containers.dictionary.create<number>([
   *   ['hello', 1],
   *   ['world', 2],
   * ]);
   *
   * console.log(dictionary.getOrInsertComputed('world', () => 3));
   * console.log(dictionary.getOrInsertComputed('fizz', (key: string) => key.length));
   * // Console output:
   * // 2
   * // 4
   * ```
   */
  public getOrInsertComputed(
    key: string,
    callback: ((key: string) => T) | Method<(key: string) => T>
  ): T {
    if (this.has(key)) {
      return this.get(key)!;
    }
    const value = callback(key);
    this.set(key, value);
    return value;
  }

  /**
   * Inserts a new entry whose key is `key` and value is `value`.
   *
   * @param key - The key of the new entry.
   * @param value - The value of the new entry.
   * @returns This {@link Dictionary}.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const dictionary = containers.dictionary.create<number>([
   *   ['hello', 1],
   *   ['world', 2],
   * ]);
   *
   * dictionary.set("fizz", 4).set("buzz", 5);
   * // `dictionary` now contains these entries:
   * // hello: 1
   * // world: 2
   * // fizz: 4
   * // buzz: 5
   * ```
   */
  public set(key: string, value: T): Dictionary<T> {
    this.impl.set(key, value);
    return this;
  }

  /**
   * Returns whether the {@link Dictionary} contains an entry with key `key`.
   *
   * @param key - The key of the entry to look up if it exists.
   * @returns `true` if the {@link Dictionary} contains an entry with key `key`,
   * otherwise `false`.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const dictionary = containers.dictionary.create<number>([
   *   ['hello', 1],
   *   ['world', 2],
   * ]);
   *
   * console.log(dictionary.has('world'));
   * console.log(dictionary.has('fizz'));
   * // Console output:
   * // true
   * // false
   * ```
   */
  public has(key: string): boolean {
    return this.impl.has(key);
  }

  /**
   * Removes the entry with `key` from the {@link Dictionary} if it exists.
   *
   * @param key - The key of the entry to remove from the {@link Dictionary}.
   * @returns `true` if the {@link Dictionary} contained an entry with key `key`,
   * otherwise `false`.
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const dictionary = containers.dictionary.create<number>([
   *   ['hello', 1],
   *   ['world', 2],
   * ]);
   *
   * console.log(dictionary.delete('world'));
   * console.log(dictionary.delete('fizz'));
   * // `dictionary` now contains these entries:
   * // hello: 1
   * //
   * // Console output:
   * // true
   * // false
   * ```
   */
  public delete(key: string): boolean {
    return this.impl.delete(key);
  }

  /**
   * Removes all entries from this {@link Dictionary}.
   *
   * @example
   * ```ts
   * const { containers } = createFutureMachine(futureDatabase);
   * const dictionary = containers.dictionary.create<number>([
   *   ['hello', 1],
   *   ['world', 2],
   * ]);
   *
   * dictionary.clear();
   * // `dictionary` is now empty.
   * ```
   */
  public clear(): void {
    this.impl.clear();
  }

  // TODO: Add thisArg parameter once Method supports it.
  public forEach(
    callback:
      | ((value: T, key: string, dictionary: Dictionary<T>) => void)
      | Method<(value: T, key: string, dictionary: Dictionary<T>) => void>
  ): void {
    this.impl.forEach(callback, this);
  }

  // TODO: How could we implement `groupBy`? We could implement it as a static
  // method here, but then it wouldn't be a serializable `Method`. We could
  // place it in the containers api object, but then it wouldn't match ECMA.

  // TODO: Add other methods that Map has.
}
