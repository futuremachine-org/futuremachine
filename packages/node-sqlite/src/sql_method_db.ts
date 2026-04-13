import {
  Method,
  MethodType,
  ObjectDB,
  ObjectDBType,
  type MethodDB,
  type MethodName,
  type Serializable,
  type SerializableDB,
  type ValidResult,
} from '@futuremachine/core';
import { assert_defined, assert_true } from './asserts.js';
import type { MethodIdDb } from './sql_database_intf.js';
import type { SQLFutureDatabaseImpl } from './sql_future_database_impl.js';

export class SQLMethodDB extends ObjectDB implements MethodDB {
  private facade:
    | Method<(...args: unknown[]) => ValidResult<Serializable>>
    | undefined;

  private garbageCollectionCount: number = -1;

  constructor(
    private database: SQLFutureDatabaseImpl,
    private name: MethodName,
    private type: MethodType,
    private bounded: SerializableDB[],
    private id?: MethodIdDb
  ) {
    super();
  }

  public getObjectType(): ObjectDBType.Method {
    return ObjectDBType.Method;
  }

  public setFacade(
    facade: Method<(...args: unknown[]) => ValidResult<Serializable>>
  ): void {
    this.facade = facade;
  }

  public getFacade():
    | Method<(...args: unknown[]) => ValidResult<Serializable>>
    | undefined {
    return this.facade;
  }

  public getId(): MethodIdDb {
    assert_true(
      this.database.isInFlush(),
      'Should only be called during a flush.'
    );
    assert_defined(this.id, 'id should already be set');
    return this.id;
  }

  public getOrCreateId(): MethodIdDb {
    assert_true(
      this.database.isInFlush(),
      'Should only be called during a flush.'
    );
    if (this.id !== undefined) {
      if (
        this.garbageCollectionCount ===
        this.database.getGarbageCollectionCount()
      ) {
        return this.id;
      }
      // If a garbage collection has happened since the last time we checked, we
      // may not be written to disk anymore. Check if we are and if we're not
      // rewrite ourselves to disk.
      if (this.database.methodsHasId(this.id)) {
        return this.id;
      }
    }
    this.garbageCollectionCount = this.database.getGarbageCollectionCount();
    this.id = this.database.getNextMethodId();

    this.database.writeMethodDb(this);

    return this.id;
  }

  public getName(): MethodName {
    return this.name;
  }

  public getType(): MethodType {
    return this.type;
  }

  public *getBounded(): Generator<SerializableDB> {
    yield* this.bounded;
  }

  public pushBounded(args: Generator<SerializableDB>): MethodDB {
    return new SQLMethodDB(
      this.database,
      this.name,
      this.type,
      [...this.bounded, ...args],
      // TODO: Make sure you have a test that fails if we pass `this.id` here
      // like we were before.
      undefined
    );
  }
}
