import type { Serializable } from '../database/future_database.js';
import type { SerializableObject } from '../database/serializable_object.js';
import {
  SerializableObjectBranding,
  StructCreate,
  StructGetImpl,
  StructImplMember,
} from '../symbols.js';
import type { StructImpl } from './struct_impl.js';

export type Struct<T extends Record<string, Serializable>> = StructClass<T> & T;

// TODO: Could this be an Entity?
class StructClass<
  T extends Record<string, Serializable>,
> implements SerializableObject {
  [SerializableObjectBranding] = undefined;

  private [StructImplMember]: StructImpl<T>;

  private constructor(impl: StructImpl<T>) {
    this[StructImplMember] = impl;
    return new Proxy(this, {
      // TODO: There are more things we need to trap in order for this to behave
      // like an Object. For example `delete` doesn't work as intended yet.
      get: (_, key) => {
        if (typeof key === 'string' && impl.has(key)) {
          return impl.get(key);
        }
        return Reflect.get(this, key, this);
      },
      set: (_, key: keyof T & string, value: T[keyof T & string]) => {
        if (typeof key === 'string' && impl.has(key)) {
          impl.set(key, value);
          return true;
        }
        return Reflect.set(this, key, value, this);
      },
      has: (_, key) => {
        return (typeof key === 'string' && impl.has(key)) || key in this;
      },
      getOwnPropertyDescriptor: (_, key) => {
        if (typeof key === 'string' && impl.has(key)) {
          return {
            value: impl.get(key),
            writable: true,
            enumerable: true,
            configurable: true,
          };
        }
        return Reflect.getOwnPropertyDescriptor(this, key);
      },
      ownKeys: (_) => {
        return impl.ownKeys();
      },
    });
  }

  public static [StructCreate]<T extends Record<string, Serializable>>(
    impl: StructImpl<T>
  ): Struct<T> {
    return new Struct<T>(impl) as Struct<T>;
  }

  public [StructGetImpl](): StructImpl<T> {
    return this[StructImplMember];
  }

  // TODO: Should we add helpers similar to the static Object helper methods to
  // the FutureMachine? E.g. `Object.hasOwn`. But `Object.hasOwn` currently
  // works with this class correctly. Still we should look through them.
}

export const Struct = StructClass;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawStruct<T extends Struct<any>> =
  T extends Struct<infer R> ? R : never;
