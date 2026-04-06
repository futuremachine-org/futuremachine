import type { FutureMachineImpl } from '../core/future_machine_impl.js';
import type { EntityDB, Serializable } from '../database/future_database.js';
import {
  deserialize,
  serialize,
  serializeRecord,
  type ToRecordDB,
} from '../database/serialize_utils.js';
import type { ExceptionEntity } from '../exceptions/exception_entity.js';
import { StateCreate, StateGetEntityImpl } from '../symbols.js';
import type { Entity } from './entity.js';

type EntityLike<T extends Record<string, Serializable>> =
  | Entity<T>
  | ExceptionEntity<T>;

export type AnyEntityConstructor = new (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arg: State<any>
) => EntityLike<Record<string, Serializable>>;

export type EntityClass<E extends AnyEntityConstructor> =
  InstanceType<E> extends Serializable
    ? {
        new (state: State<EntityState<E>>): InstanceType<E>;
      }
    : never;

export type EntityState<E extends AnyEntityConstructor> =
  InstanceType<E> extends EntityLike<infer S> ? S : never;

export class State<T extends Record<string, Serializable>> {
  private constructor(
    private futureMachine: FutureMachineImpl,
    private entityDb: EntityDB<ToRecordDB<T>>
  ) {}

  public static [StateCreate]<T extends Record<string, Serializable>>(
    futureMachine: FutureMachineImpl,
    entityDb: EntityDB<ToRecordDB<T>>
  ) {
    return new State(futureMachine, entityDb);
  }

  public [StateGetEntityImpl](): EntityImpl<T> {
    return new EntityImpl(this.futureMachine, this.entityDb);
  }
}

export class StateBuilder {
  constructor(
    private futureMachine: FutureMachineImpl,
    private entityName: string
  ) {}
  build<T extends Record<string, Serializable>>(state: T): State<T> {
    return State[StateCreate](
      this.futureMachine,
      this.futureMachine.createEntityDB(this.entityName, serializeRecord(state))
    ) as State<T>;
  }
}

export class EntityImpl<T extends Record<string, Serializable>> {
  constructor(
    // TODO: Should these be symbols?
    private futureMachine: FutureMachineImpl,
    private entityDb: EntityDB<ToRecordDB<T>>
  ) {}

  public getEntityDB() {
    return this.entityDb;
  }

  public get<U extends keyof T & string>(prop: U): T[U] {
    return deserialize<T[U]>(this.futureMachine, this.entityDb.get(prop));
  }

  public set<U extends keyof T & string>(key: U, value: T[U]) {
    this.entityDb.set(key, serialize(value));
  }
}
