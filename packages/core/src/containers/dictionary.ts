import type { Serializable } from '../database/future_database.js';
import type { SerializableObject } from '../database/serializable_object.js';
import {
  DictionaryCreate,
  DictionaryGetImpl,
  SerializableObjectBranding,
} from '../symbols.js';
import type { DictionaryImpl } from './dictionary_impl.js';

// TODO: Should we support having Keys of any serializable type?
export class Dictionary<T extends Serializable> implements SerializableObject {
  public [SerializableObjectBranding] = undefined;

  private constructor(private impl: DictionaryImpl<T>) {}

  public static [DictionaryCreate]<T extends Serializable>(
    impl: DictionaryImpl<T>
  ): Dictionary<T> {
    return new Dictionary<T>(impl);
  }

  public [DictionaryGetImpl](): DictionaryImpl<T> {
    return this.impl;
  }

  public get(key: string): T | undefined {
    return this.impl.get(key);
  }

  public set(key: string, value: T): Dictionary<T> {
    this.impl.set(key, value);
    return this;
  }

  public has(key: string): boolean {
    return this.impl.has(key);
  }

  public delete(key: string): boolean {
    return this.impl.delete(key);
  }

  public clear(): void {
    this.impl.clear();
  }

  // TODO: Add other methods that Map has.
}
