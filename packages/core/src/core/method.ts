import type { Serializable } from '../database/future_database.js';
import type { SerializableObject } from '../database/serializable_object.js';
import {
  MethodCreate,
  MethodGetImpl,
  SerializableObjectBranding,
} from '../symbols.js';
import type { ValidResult } from './future_impl.js';
import {
  type AnyMethodImpl,
  type MethodImpl,
  type MethodName,
} from './method_impl.js';

export type { MethodName } from './method_impl.js';

export type Method<Impl extends AnyMethodImpl> = MethodClass<Impl> &
  Impl & {
    // TODO: Implement all of these:
    arguments: never;
    apply: never;
    call: never;
    caller: never;
    length: never;
    toString: never;
  };

class MethodClass<Impl extends AnyMethodImpl> implements SerializableObject {
  [SerializableObjectBranding] = undefined;

  private constructor(private impl: MethodImpl<Impl>) {
    const func = (...args: Parameters<Impl>) => {
      return this.impl.run(...args);
    };

    Object.setPrototypeOf(func, MethodClass.prototype);

    // Use Proxy so that this class can be called.
    return new Proxy(func, {
      // TODO: See if you need to add more traps here.
      get: (_, prop) => {
        return Reflect.get(this, prop, this);
      },
      set: (_, prop, value) => {
        return Reflect.set(this, prop, value, this);
      },
    }) as unknown as Method<Impl>;
  }

  public static [MethodCreate]<Impl extends AnyMethodImpl>(
    impl: MethodImpl<Impl>
  ): Method<Impl> {
    return new Method<Impl>(impl) as Method<Impl>;
  }

  public [MethodGetImpl](): MethodImpl<Impl> {
    return this.impl;
  }

  public name(): MethodName {
    return this.impl.getName();
  }

  public bindArgs<
    A extends Serializable[],
    B extends unknown[],
    R extends ValidResult<Serializable>,
  >(
    this: Method<(...args: [...A, ...B]) => R>,
    ...args: A
  ): Method<(...args: B) => R> {
    const method = new Method<(...args: B) => R>(
      this.impl.bindArgs(...args)
    ) as Method<(...args: B) => R>;

    method.impl.getMethodDb().setFacade(method);

    return method;
  }
}

export const Method = MethodClass;
