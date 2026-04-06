import type { FutureMachineImpl } from '../core/future_machine_impl.js';
import type { Serializable, StructDB } from '../database/future_database.js';
import {
  deserialize,
  serialize,
  type ToRecordDB,
} from '../database/serialize_utils.js';

export class StructImpl<T extends Record<string, Serializable>> {
  constructor(
    private futureMachine: FutureMachineImpl,
    private structDb: StructDB<ToRecordDB<T>>
  ) {}

  public getStructDb(): StructDB<ToRecordDB<T>> {
    return this.structDb;
  }

  public has<U extends keyof T & string>(key: U): boolean {
    return this.structDb.has(key);
  }

  public get<U extends keyof T & string>(key: U): T[U] {
    return deserialize<T[U]>(this.futureMachine, this.structDb.get(key));
  }

  public set<U extends keyof T & string>(key: U, value: T[U]): void {
    this.structDb.set(key, serialize(value));
  }

  public ownKeys(): (keyof T & string)[] {
    // Don't need to deserialize since the keys should be the same serialized
    // and deserialized.
    return this.structDb.ownKeys();
  }
}
