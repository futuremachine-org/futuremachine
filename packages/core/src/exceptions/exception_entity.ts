import type { EntityImpl, State } from '../containers/entity_impl.js';
import type { Serializable } from '../database/future_database.js';
import type { SerializableObject } from '../database/serializable_object.js';
import {
  EntityGetImpl,
  SerializableObjectBranding,
  StateGetEntityImpl,
} from '../symbols.js';

// This implements the same interface as Entity but extends Error so that
// Exception can extend Error. This makes it so that the console prints the
// Error prettier when thrown.
export abstract class ExceptionEntity<T extends Record<string, Serializable>>
  extends Error
  implements SerializableObject
{
  [SerializableObjectBranding] = undefined;

  private impl: EntityImpl<T>;
  constructor(state: State<T>) {
    super();
    this.impl = state[StateGetEntityImpl]();
  }

  public [EntityGetImpl]() {
    return this.impl;
  }

  protected get<U extends keyof T & string>(prop: U): T[U] {
    return this.impl.get(prop);
  }

  protected set<U extends keyof T & string>(key: U, value: T[U]) {
    this.impl.set(key, value);
  }
}
