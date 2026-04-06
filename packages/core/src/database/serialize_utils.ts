import { assert_true, assert_unreached } from '../asserts.js';
import { Dictionary } from '../containers/dictionary.js';
import { Entity } from '../containers/entity.js';
import { List } from '../containers/list.js';
import { Struct } from '../containers/struct.js';
import { Future } from '../core/future.js';
import type { FutureMachineImpl } from '../core/future_machine_impl.js';
import { Method } from '../core/method.js';
import type { AnyMethodImpl } from '../core/method_impl.js';
import { ExceptionEntity } from '../exceptions/exception_entity.js';
import {
  DictionaryGetImpl,
  EntityGetImpl,
  FutureGetImpl,
  ListGetImpl,
  MethodGetImpl,
  StructGetImpl,
} from '../symbols.js';
import {
  ObjectDB,
  ObjectDBType,
  type DictionaryDB,
  type EntityDB,
  type FutureDB,
  type ListDB,
  type MethodDB,
  type Serializable,
  type SerializableDB,
  type StructDB,
  type ToSerializableDB,
} from './future_database.js';

export type ToRecordDB<T extends Record<string, Serializable>> = {
  [K in keyof T & string]: ToSerializableDB<T[K]>;
};

export type ToArrayDB<T extends Serializable[]> = {
  [K in keyof T]: T[K] extends Serializable ? ToSerializableDB<T[K]> : T[K];
};

export function isSerializable(
  serializable: unknown
): serializable is Serializable {
  switch (typeof serializable) {
    case 'boolean':
    case 'undefined':
    case 'number':
    case 'bigint':
    case 'string':
      return true;
    case 'object':
      if (serializable === null) {
        return true;
      }
      return [Future, Dictionary, Struct, List, Entity, ExceptionEntity].some(
        (serializableClass) => serializable instanceof serializableClass
      );
    case 'symbol':
    case 'function':
      // TODO: We were incorrectly returning false here before and no tests
      // failed. Create a test that verifies that this works correctly.
      return serializable instanceof Method;
  }
}

export function serialize<T extends Serializable>(
  serializable: T
): ToSerializableDB<T> {
  switch (typeof serializable) {
    case 'boolean':
    case 'undefined':
    case 'number':
    case 'bigint':
    case 'string':
      return serializable as ToSerializableDB<T>;

    case 'object':
      if (serializable === null) {
        return serializable as ToSerializableDB<T>;
      }
      if (serializable instanceof Future) {
        return serializable[
          FutureGetImpl
        ]().getFutureDB() as unknown as ToSerializableDB<T>;
      }
      if (serializable instanceof Dictionary) {
        return serializable[
          DictionaryGetImpl
        ]().getDictionaryDb() as unknown as ToSerializableDB<T>;
      }
      if (serializable instanceof Struct) {
        return serializable[
          StructGetImpl
        ]().getStructDb() as unknown as ToSerializableDB<T>;
      }
      if (serializable instanceof List) {
        return serializable[
          ListGetImpl
        ]().getListDb() as unknown as ToSerializableDB<T>;
      }
      if (
        serializable instanceof Entity ||
        serializable instanceof ExceptionEntity
      ) {
        return serializable[
          EntityGetImpl
        ]().getEntityDB() as unknown as ToSerializableDB<T>;
      }

      // This is never exposed external to the library so has no facade.
      // Stryker disable all
      assert_true(
        serializable instanceof ObjectDB &&
          serializable.getObjectType() == ObjectDBType.Aggregate,
        'Attempted to serialize object that was not serializable.'
      );
      // Stryker restore all
      return serializable as unknown as ToSerializableDB<T>;
    /* c8 ignore next 2 */
    case 'symbol':
      assert_unreached(`'${typeof serializable}' is not serializable.`);
    // eslint-disable-next-line no-fallthrough
    case 'function':
      if ((serializable as unknown) instanceof Method) {
        return (serializable as Method<AnyMethodImpl>)
          [MethodGetImpl]()
          .getMethodDb() as unknown as ToSerializableDB<T>;
      }
      /* c8 ignore next 1 */
      assert_unreached(`'${typeof serializable}' is not serializable.`);
  }
}

export function deserialize<T extends Serializable>(
  futureMachineImpl: FutureMachineImpl,
  serializedDb: ToSerializableDB<T>
): T {
  if (serializedDb instanceof ObjectDB) {
    switch (serializedDb.getObjectType()) {
      // This is never exposed external to the library so has no facade.
      case ObjectDBType.Aggregate:
        return serializedDb as T;
      case ObjectDBType.Dictionary:
        return futureMachineImpl.getDictionaryFromDictionaryDB(
          serializedDb as DictionaryDB<SerializableDB>
        ) as unknown as T;
      case ObjectDBType.Entity:
        return futureMachineImpl.getEntityFromEntityDB(
          serializedDb as EntityDB<Record<string, SerializableDB>>
        ) as unknown as T;
      case ObjectDBType.List:
        return futureMachineImpl.getListFromListDB(
          serializedDb as ListDB<SerializableDB[]>
        ) as unknown as T;
      case ObjectDBType.Struct:
        return futureMachineImpl.getStructFromStructDB(
          serializedDb as StructDB<Record<string, SerializableDB>>
        ) as unknown as T;
      case ObjectDBType.Method:
        return futureMachineImpl.getMethodFromMethodDB(
          serializedDb as MethodDB
        ) as unknown as T;
      case ObjectDBType.Future:
        return futureMachineImpl.getFutureFromFutureDB(
          serializedDb as FutureDB<SerializableDB>
        ) as unknown as T;
      /* c8 ignore next 5 */
      // Stryker disable next-line all
      default:
        assert_unreached(
          `Invalid ObjectDBType: ${serializedDb.getObjectType()}`
        );
    }
  }
  // TODO: I want to do typeof here similar to serialize and IsSerializable
  // instead of assuming that it can be deserialized.
  return serializedDb as T;
}

export function* serializeArgs<T extends Serializable>(
  args: Iterable<T>
): Generator<ToSerializableDB<T>> {
  for (const arg of args) {
    yield serialize(arg);
  }
}

export function* deserializeArgs<T extends Serializable>(
  futureMachineImpl: FutureMachineImpl,
  args: Iterable<ToSerializableDB<T>>
): Generator<T> {
  for (const arg of args) {
    yield deserialize(futureMachineImpl, arg);
  }
}

export function serializeRecord<T extends Record<string, Serializable>>(
  obj: T
): ToRecordDB<T> {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      return [key, serialize(value)];
    })
  ) as ToRecordDB<T>;
}
