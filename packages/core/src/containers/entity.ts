import type { Serializable } from '../database/future_database.js';
import type { SerializableObject } from '../database/serializable_object.js';
import {
  EntityGetImpl,
  SerializableObjectBranding,
  StateGetEntityImpl,
} from '../symbols.js';
import type { EntityImpl, State } from './entity_impl.js';

export abstract class Entity<
  T extends Record<string, Serializable>,
> implements SerializableObject {
  [SerializableObjectBranding] = undefined;

  private impl: EntityImpl<T>;
  constructor(state: State<T>) {
    this.impl = state[StateGetEntityImpl]();
    this.impl.getEntityDB().setFacade(this);
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
