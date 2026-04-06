import type { FutureMachineImpl } from '../core/future_machine_impl.js';
import type {
  DictionaryDB,
  Serializable,
  ToSerializableDB,
} from '../database/future_database.js';
import { deserialize, serialize } from '../database/serialize_utils.js';

export class DictionaryImpl<T extends Serializable> {
  constructor(
    private futureMachine: FutureMachineImpl,
    private dictionaryDb: DictionaryDB<ToSerializableDB<T>>
  ) {}

  public getDictionaryDb(): DictionaryDB<ToSerializableDB<T>> {
    return this.dictionaryDb;
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
}
