import type { FutureMachineImpl } from '../core/future_machine_impl.js';
import type { Method } from '../core/method.js';
import type {
  DictionaryDB,
  Serializable,
  ToSerializableDB,
} from '../database/future_database.js';
import { deserialize, serialize } from '../database/serialize_utils.js';
import type { Dictionary } from './dictionary.js';

export class DictionaryImpl<T extends Serializable> {
  constructor(
    private futureMachine: FutureMachineImpl,
    private dictionaryDb: DictionaryDB<ToSerializableDB<T>>
  ) {}

  public getDictionaryDb(): DictionaryDB<ToSerializableDB<T>> {
    return this.dictionaryDb;
  }

  public size(): number {
    return this.dictionaryDb.size();
  }

  public entries(): IteratorObject<[string, T]> {
    return this.dictionaryDb.entries().map(([key, value]) => {
      return [key, deserialize(this.futureMachine, value)];
    });
  }

  public keys(): IteratorObject<string> {
    return this.dictionaryDb.keys();
  }

  public get(key: string): T | undefined {
    // TODO: Should we be deserializing it every time? Or maybe we should keep
    // the deserialized value in a map in the impl?

    return deserialize<T | undefined>(
      this.futureMachine,
      this.dictionaryDb.get(key)
    );
  }

  public set(key: string, value: T): void {
    this.dictionaryDb.set(key, serialize(value));
  }

  public has(key: string): boolean {
    return this.dictionaryDb.has(key);
  }

  public delete(key: string): boolean {
    return this.dictionaryDb.delete(key);
  }

  public clear(): void {
    this.dictionaryDb.clear();
  }

  // TODO: Add thisArg parameter once Method supports it.
  public forEach(
    callback: (
      value: T,
      key: string,
      dictionary: Dictionary<T>
    ) => void | Method<
      (value: T, key: string, dictionary: Dictionary<T>) => void
    >,
    dictionary: Dictionary<T>
  ): void {
    for (const [key, value] of this.entries()) {
      callback(value, key, dictionary);
    }
  }
}
