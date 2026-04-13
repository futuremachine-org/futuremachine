import {
  FutureState,
  MethodType,
  type FromSerializableDB,
  type FutureId,
  type SerializableDB,
} from '@futuremachine/core';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { assert_true } from './asserts.js';

export enum ValueType {
  // Do not change these. These values are written to disk.
  Boolean = 0,
  Number = 1,
  Bigint = 2,
  String = 3,
  Undefined = 4,
  Null = 5,
  Obj = 6,
  Future = 7,
  Method = 8,
}

export enum SQLObjectType {
  // Do not change these. These values are written to disk.
  Aggregate = 0,
  Dictionary = 1,
  Struct = 2,
  List = 3,
  Entity = 4,
}

export enum BooleanDb {
  // Do not change these. These values are written to disk.
  False = 0,
  True = 1,
}

enum FutureStateDb {
  // Do not change these. These values are written to disk.
  Pending = 0,
  Fulfilled = 1,
  Rejected = 2,
}

enum MethodTypeDb {
  // Do not change these. These values are written to disk.
  Internal = 0,
  External = 1,
}

enum MarkSet {
  // Do not change these. These values are written to disk.
  Set1 = 0,
  Set2 = 1,
}

export type FutureIdDb = string;

export type ObjectIdDb = number;
export type MethodIdDb = number;

type InternalFutureDB = {
  root: BooleanDb;
  state: FutureStateDb;
  alreadySettled: BooleanDb;
  valueType: number | null;
  value: string | null;
};

// TODO: Naming. I think this should be like SqlDatabaseInterface
export class SqlDatabaseIntf {
  private sqlDatabase: DatabaseSync;

  private currentMark: MarkSet;

  private inFlush: boolean = false;

  private setCurrentMarkStatement: StatementSync;
  private getNextObjectIdStatement: StatementSync;
  private getNextMethodIdStatement: StatementSync;
  private getFutureStatement: StatementSync;
  private getAndMarkFuturesStatement: StatementSync;
  private sweepMethodsStatement: StatementSync;
  private methodsHasIdStatement: StatementSync;
  private getAndMarkRootsStatement: StatementSync;
  private getMethodStatement: StatementSync;
  private getAndMarkMethodsStatement: StatementSync;
  private sweepFuturesStatement: StatementSync;
  private futuresHasIdStatement: StatementSync;
  private setFutureFulfillOrRejectStatement: StatementSync;
  private setFutureSettledStatement: StatementSync;
  private createFulfillReactionStatement: StatementSync;
  private createRejectReactionStatement: StatementSync;
  private createFutureStatement: StatementSync;
  private createMethodStatement: StatementSync;
  private createObjectStatement: StatementSync;
  private updateObjectStatement: StatementSync;
  private getFulfillReactionsStatement: StatementSync;
  private getRejectReactionsStatement: StatementSync;
  private getObjectStatement: StatementSync;
  private deleteObjectStatement: StatementSync;
  private getAndMarkObjectsStatement: StatementSync;
  private sweepFulfillReactionsStatement: StatementSync;
  private deleteFulfillReactionsStatement: StatementSync;
  private getAndMarkFulfillReactionsStatement: StatementSync;
  private sweepRejectReactionsStatement: StatementSync;
  private deleteRejectReactionsStatement: StatementSync;
  private getAndMarkRejectReactionsStatement: StatementSync;
  private sweepObjectsStatement: StatementSync;
  private objectsHasIdStatement: StatementSync;
  private getReactionsCountForTestingStatement: StatementSync;
  private getFuturesCountForTestingStatement: StatementSync;
  private getMethodsCountForTestingStatement: StatementSync;
  private getObjectsCountForTestingStatement: StatementSync;

  constructor(private databasePath: string) {
    // TODO: This can throw
    this.sqlDatabase = new DatabaseSync(this.databasePath, {
      // TODO: Review the options again.
    });
    // TODO: Consider SQLTagSTore

    // TODO: This can throw
    this.sqlDatabase.exec(`
        PRAGMA journal_mode = WAL;
        -- // TODO: Make this configurable. Had it on NORMAL but that made tests
        -- // too slow, but we are frequently creating and destroying databases.
        PRAGMA synchronous = OFF;

        CREATE TABLE IF NOT EXISTS metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          objectIdCount INTEGER NOT NULL,
          methodIdCount INTEGER NOT NULL,
          currentMark INTEGER NOT NULL
            CHECK (currentMark IN (${MarkSet.Set1}, ${MarkSet.Set2}))
        );
        INSERT OR IGNORE INTO metadata
        (id, objectIdCount, methodIdCount, currentMark)
        VALUES (1, 0, 0, ${MarkSet.Set1});

        CREATE TABLE IF NOT EXISTS futures (
          id TEXT PRIMARY KEY,
          mark INTEGER NOT NULL
            CHECK (mark IN (${MarkSet.Set1}, ${MarkSet.Set2})),
          root BOOLEAN NOT NULL
            CHECK (root IN (${BooleanDb.False}, ${BooleanDb.True})),
          state INTEGER NOT NULL 
            CHECK (state IN (${FutureStateDb.Pending}, ${FutureStateDb.Fulfilled}, ${FutureStateDb.Rejected})),
          alreadySettled BOOLEAN NOT NULL
            CHECK (alreadySettled IN (${BooleanDb.False}, ${BooleanDb.True})),
          valueType INTEGER
            CHECK (valueType IN (${ValueType.Boolean}, ${ValueType.Number}, ${ValueType.Bigint}, ${ValueType.String}, ${ValueType.Undefined}, ${ValueType.Null}, ${ValueType.Obj}, ${ValueType.Future}, ${ValueType.Method})),
          value TEXT
        );
        CREATE TABLE IF NOT EXISTS fulfillReactions (
          futureId INTEGER,
          mark INTEGER NOT NULL
            CHECK (mark IN (${MarkSet.Set1}, ${MarkSet.Set2})),
          nextFutureId INTEGER NOT NULL,
          methodId INTEGER,
          FOREIGN KEY (methodId) REFERENCES methods(id) ON DELETE RESTRICT
        );

        CREATE INDEX IF NOT EXISTS fulfillReactionsIndex
        ON fulfillReactions (futureId);

        CREATE TABLE IF NOT EXISTS rejectReactions (
          futureId INTEGER,
          mark INTEGER NOT NULL
            CHECK (mark IN (${MarkSet.Set1}, ${MarkSet.Set2})),
          nextFutureId INTEGER NOT NULL,
          methodId INTEGER,
          FOREIGN KEY (methodId) REFERENCES methods(id) ON DELETE RESTRICT
        );

        CREATE INDEX IF NOT EXISTS rejectReactionsIndex
        ON rejectReactions (futureId);

        CREATE TABLE IF NOT EXISTS methods (
          id INTEGER PRIMARY KEY,
          mark INTEGER NOT NULL
            CHECK (mark IN (${MarkSet.Set1}, ${MarkSet.Set2})),
          name TEXT NOT NULL,
          type INTEGER NOT NULL
            CHECK (type IN (${MethodTypeDb.External}, ${MethodTypeDb.Internal})),
          bounded TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS objects (
          id INTEGER PRIMARY KEY,
          mark INTEGER NOT NULL
            CHECK (mark IN (${MarkSet.Set1}, ${MarkSet.Set2})),
          type INTEGER NOT NULL
            CHECK (type in (${SQLObjectType.Aggregate}, ${SQLObjectType.Dictionary}, ${SQLObjectType.Struct}, ${SQLObjectType.List}, ${SQLObjectType.Entity})),
          value TEXT NOT NULL
        );
        `);

    // Statements for "metadata" table.
    this.currentMark = this.getCurrentMark();
    this.setCurrentMarkStatement = this.sqlDatabase.prepare(`
        UPDATE metadata
        SET currentMark = ?
        WHERE id = 1;
        `);

    this.getNextObjectIdStatement = this.sqlDatabase.prepare(`
        UPDATE metadata
        SET objectIdCount = objectIdCount + 1
        WHERE id = 1
        RETURNING objectIdCount;
        `);

    this.getNextMethodIdStatement = this.sqlDatabase.prepare(`
        UPDATE metadata
        SET methodIdCount = methodIdCount + 1
        WHERE id = 1
        RETURNING methodIdCount;
        `);

    // Statements for "methods" table.
    this.createMethodStatement = this.sqlDatabase.prepare(`
        INSERT INTO methods
        (id, mark, name, type, bounded)
        VALUES (?, ?, ?, ?, ?);
        `);
    this.getMethodStatement = this.sqlDatabase.prepare(`
        SELECT name, type, bounded
        FROM methods
        WHERE id = ?;
        `);
    this.getAndMarkMethodsStatement = this.sqlDatabase.prepare(`
        UPDATE methods
        SET mark = ?
        WHERE mark != ?
          AND id IN (SELECT value FROM json_each(?))
        RETURNING bounded;
        `);
    this.sweepMethodsStatement = this.sqlDatabase.prepare(`
        DELETE FROM methods WHERE mark != ?;
        `);
    this.methodsHasIdStatement = this.sqlDatabase.prepare(`
        SELECT EXISTS(SELECT 1 FROM methods WHERE id = ?);
        `);

    // Statements for "futures" table.
    this.createFutureStatement = this.sqlDatabase.prepare(`
        INSERT INTO futures
        (id, mark, root, state, alreadySettled, valueType, value)
        VALUES (?, ?, ?, ?, ?, ?, ?);
        `);
    this.setFutureSettledStatement = this.sqlDatabase.prepare(`
        UPDATE futures
        SET root = ${BooleanDb.False},
            alreadySettled = ${BooleanDb.True}
        WHERE id = ?;
        `);
    this.setFutureFulfillOrRejectStatement = this.sqlDatabase.prepare(`
        UPDATE futures
        SET root = ${BooleanDb.False},
            state = ?,
            alreadySettled = ${BooleanDb.True},
            valueType = ?,
            value = ?
        WHERE id = ?;
        `);
    this.getFutureStatement = this.sqlDatabase.prepare(`
        SELECT root, state, alreadySettled, valueType, value
        FROM futures
        WHERE id = ?;
        `);
    this.getAndMarkFuturesStatement = this.sqlDatabase.prepare(`
        UPDATE futures
        SET mark = ?
        WHERE mark != ?
          AND id IN (SELECT value FROM json_each(?))
        RETURNING valueType, value;
        `);
    this.sweepFuturesStatement = this.sqlDatabase.prepare(`
        DELETE FROM futures WHERE mark != ?;
        `);
    this.futuresHasIdStatement = this.sqlDatabase.prepare(`
        SELECT EXISTS(SELECT 1 FROM futures WHERE id = ?);
        `);

    this.getAndMarkRootsStatement = this.sqlDatabase.prepare(`
        UPDATE futures
        SET mark = ?
        WHERE root = ${BooleanDb.True}
        RETURNING id;
        `);

    // Statements for "fulfillReactions" table.
    this.createFulfillReactionStatement = this.sqlDatabase.prepare(`
        INSERT INTO fulfillReactions
        (futureId, mark, nextFutureId, methodId)
        VALUES (?, ?, ?, ?);
        `);
    this.getFulfillReactionsStatement = this.sqlDatabase.prepare(`
        SELECT nextFutureId, methodId FROM fulfillReactions WHERE futureId = ?;
        `);
    this.deleteFulfillReactionsStatement = this.sqlDatabase.prepare(`
        DELETE FROM fulfillReactions WHERE futureId = ?;
        `);
    this.getAndMarkFulfillReactionsStatement = this.sqlDatabase.prepare(`
        UPDATE fulfillReactions
        SET mark = ?
        WHERE mark != ?
          AND futureId IN (SELECT value FROM json_each(?))
        RETURNING nextFutureId, methodId;
        `);
    this.sweepFulfillReactionsStatement = this.sqlDatabase.prepare(`
        DELETE FROM fulfillReactions WHERE mark != ?;
        `);

    // Statements for "rejectReactions" table.
    this.createRejectReactionStatement = this.sqlDatabase.prepare(`
        INSERT INTO rejectReactions
        (futureId, mark, nextFutureId, methodId)
        VALUES (?, ?, ?, ?);
        `);
    this.getRejectReactionsStatement = this.sqlDatabase.prepare(`
        SELECT nextFutureId, methodId FROM rejectReactions WHERE futureId = ?;
        `);
    this.deleteRejectReactionsStatement = this.sqlDatabase.prepare(`
        DELETE FROM rejectReactions WHERE futureId = ?;
        `);
    this.getAndMarkRejectReactionsStatement = this.sqlDatabase.prepare(`
        UPDATE rejectReactions
        SET mark = ?
        WHERE mark != ?
          AND futureId IN (SELECT value FROM json_each(?))
        RETURNING nextFutureId, methodId;
        `);
    this.sweepRejectReactionsStatement = this.sqlDatabase.prepare(`
        DELETE FROM rejectReactions WHERE mark != ?;
        `);

    // Statements for "objects" table.
    this.createObjectStatement = this.sqlDatabase.prepare(`
        INSERT INTO objects
        (mark, id, type, value)
        VALUES (?, ?, ?, ?);
        `);
    this.updateObjectStatement = this.sqlDatabase.prepare(`
        UPDATE objects
        SET value = ?
        WHERE id = ?;
        `);
    this.getObjectStatement = this.sqlDatabase.prepare(`
        SELECT type, value from objects WHERE id = ?;
        `);
    this.deleteObjectStatement = this.sqlDatabase.prepare(`
        DELETE FROM objects WHERE id = ?;
        `);
    this.getAndMarkObjectsStatement = this.sqlDatabase.prepare(`
        UPDATE objects
        SET mark = ?
        WHERE mark != ?
          AND id IN (SELECT value FROM json_each(?))
        RETURNING type, value;
        `);
    this.sweepObjectsStatement = this.sqlDatabase.prepare(`
        DELETE FROM objects WHERE mark != ?;
        `);
    this.objectsHasIdStatement = this.sqlDatabase.prepare(`
        SELECT EXISTS(SELECT 1 FROM objects WHERE id = ?);
        `);

    // Statements for testing.
    this.getReactionsCountForTestingStatement = this.sqlDatabase.prepare(`
        SELECT COUNT(*) AS count
        FROM (
          SELECT 1 FROM fulfillReactions
          UNION ALL
          SELECT 1 FROM rejectReactions
        );
        `);
    this.getFuturesCountForTestingStatement = this.sqlDatabase.prepare(`
        SELECT COUNT(*) AS count
        FROM futures;
        `);
    this.getMethodsCountForTestingStatement = this.sqlDatabase.prepare(`
        SELECT COUNT(*) AS count
        FROM methods;
        `);
    this.getObjectsCountForTestingStatement = this.sqlDatabase.prepare(`
        SELECT COUNT(*) AS count
        FROM objects;
        `);
  }

  private getCurrentMark() {
    const { currentMark } = this.sqlDatabase
      .prepare('SELECT currentMark FROM metadata WHERE id = 1')
      .get() as { currentMark: MarkSet };
    return currentMark;
  }

  public flipCurrentMark() {
    this.currentMark =
      this.currentMark === MarkSet.Set1 ? MarkSet.Set2 : MarkSet.Set1;
    this.setCurrentMarkStatement.run(this.currentMark);
  }

  public sweepUnmarkedObjects() {
    this.sweepFulfillReactionsStatement.run(this.currentMark);
    this.sweepRejectReactionsStatement.run(this.currentMark);
    this.sweepMethodsStatement.run(this.currentMark);
    this.sweepFuturesStatement.run(this.currentMark);
    this.sweepObjectsStatement.run(this.currentMark);
  }

  public close() {
    this.sqlDatabase.close();
  }

  public startFlush() {
    this.inFlush = true;
  }

  public endFlush() {
    this.inFlush = false;
  }

  public isInFlush() {
    return this.inFlush;
  }

  public startTransaction() {
    this.sqlDatabase.exec('BEGIN IMMEDIATE;');
  }

  public endTransaction() {
    this.sqlDatabase.exec('COMMIT;');
  }

  private getAndMarkReactionsImpl(
    statement: StatementSync,
    futureIds: FutureIdDb[]
  ): {
    nextFutureId: FutureIdDb;
    methodId: MethodIdDb | null;
  }[] {
    return statement.all(
      this.currentMark,
      this.currentMark,
      JSON.stringify(futureIds)
    ) as {
      nextFutureId: FutureIdDb;
      methodId: MethodIdDb | null;
    }[];
  }

  // Methods for "methods" table.

  public getNextMethodId(): MethodIdDb {
    assert_true(this.inFlush, 'Not in a flush.');
    const result = this.getNextMethodIdStatement.get() as {
      methodIdCount: number;
    };
    return result.methodIdCount - 1;
  }

  public createMethod(
    id: MethodIdDb,
    name: string,
    type: MethodType,
    bounded: {
      valueType: ValueType;
      value: string;
    }[]
  ) {
    assert_true(this.inFlush, 'Not in a flush.');
    this.createMethodStatement.run(
      id,
      this.currentMark,
      name,
      this.toMethodTypeDb(type),
      this.toBoundedDb(bounded)
    );
  }

  public getMethod(id: MethodIdDb): {
    name: string;
    type: MethodType;
    bounded: {
      valueType: ValueType;
      value: string;
    }[];
  } {
    const { name, type, bounded } = this.getMethodStatement.get(id) as {
      name: string;
      type: MethodTypeDb;
      bounded: string;
    };
    return {
      name,
      type: this.fromMethodTypeDb(type),
      bounded: this.fromBoundedDb(bounded),
    };
  }

  public getAndMarkMethods(ids: MethodIdDb[]): {
    bounded: string;
  }[] {
    return this.getAndMarkMethodsStatement.all(
      this.currentMark,
      this.currentMark,
      JSON.stringify(ids)
    ) as {
      bounded: string;
    }[];
  }

  public methodsHasId(id: ObjectIdDb): boolean {
    const [hasId] = Object.values(this.methodsHasIdStatement.get(id)!);
    return hasId === 1;
  }

  // Methods for "futures" table.

  public createFuture(
    id: FutureIdDb,
    root: boolean,
    state: FutureState,
    alreadySettled: boolean,
    valueType: ValueType | undefined,
    value: string | undefined
  ) {
    assert_true(this.inFlush, 'Not in a flush.');
    const internalRoot = this.toBooleanDb(root);
    const internalState = this.toFutureStateDb(state);
    const internalAlreadySettled = this.toBooleanDb(alreadySettled);
    this.createFutureStatement.run(
      id,
      this.currentMark,
      internalRoot,
      internalState,
      internalAlreadySettled,
      valueType ?? null,
      value ?? null
    );
  }

  public setFutureSettled(id: FutureIdDb) {
    assert_true(this.inFlush, 'Not in a flush.');
    this.setFutureSettledStatement.run(id);
  }

  public setFutureFulfillOrReject(
    id: FutureIdDb,
    state: FutureState,
    valueType: ValueType,
    value: string
  ) {
    assert_true(this.inFlush, 'Not in a flush.');
    this.setFutureFulfillOrRejectStatement.run(
      this.toFutureStateDb(state),
      valueType,
      value,
      id
    );
  }

  public getAndMarkRoots(): {
    id: FutureIdDb;
  }[] {
    return this.getAndMarkRootsStatement.all(this.currentMark) as {
      id: FutureIdDb;
    }[];
  }

  public getAndMarkFutures(ids: FutureIdDb[]): {
    valueType: ValueType | null;
    value: string | null;
  }[] {
    return this.getAndMarkFuturesStatement.all(
      this.currentMark,
      this.currentMark,
      JSON.stringify(ids)
    ) as {
      valueType: ValueType | null;
      value: string | null;
    }[];
  }

  public futuresHasId(id: FutureIdDb) {
    const [hasId] = Object.values(this.futuresHasIdStatement.get(id)!);
    return hasId === 1;
  }

  public getFuture(id: FutureIdDb):
    | {
        root: boolean;
        state: FutureState;
        alreadySettled: boolean;
        valueType: number | undefined;
        value: string | undefined;
      }
    | undefined {
    const result = this.getFutureStatement.get(id) as
      | InternalFutureDB
      | undefined;

    if (result === undefined) {
      return undefined;
    }

    return {
      root: this.fromBooleanDb(result.root),
      state: this.fromFutureStateDb(result.state),
      alreadySettled: this.fromBooleanDb(result.alreadySettled),
      valueType: result.valueType ?? undefined,
      value: result.value ?? undefined,
    };
  }

  // Methods for "fulfillReactions" table.

  public createFulfillReaction(
    futureId: FutureIdDb,
    nextFutureId: FutureIdDb,
    methodId: MethodIdDb | undefined
  ) {
    assert_true(this.inFlush, 'Not in a flush.');
    this.createFulfillReactionStatement.run(
      futureId,
      this.currentMark,
      nextFutureId,
      methodId ?? null
    );
  }

  public getFulfillReactions(futureId: FutureIdDb): {
    nextFutureId: FutureIdDb;
    methodId: MethodIdDb | null;
  }[] {
    return this.getFulfillReactionsStatement.all(futureId) as {
      nextFutureId: FutureIdDb;
      methodId: MethodIdDb | null;
    }[];
  }

  public deleteFulfillReactions(futureId: FutureIdDb) {
    assert_true(this.inFlush, 'Not in a flush.');
    this.deleteFulfillReactionsStatement.run(futureId);
  }

  public getAndMarkFulfillReactions(futureIds: FutureIdDb[]): {
    nextFutureId: FutureIdDb;
    methodId: MethodIdDb | null;
  }[] {
    return this.getAndMarkReactionsImpl(
      this.getAndMarkFulfillReactionsStatement,
      futureIds
    );
  }

  // Methods for "rejectReactions" table.

  public createRejectReaction(
    futureId: FutureIdDb,
    nextFutureId: FutureIdDb,
    methodId: MethodIdDb | undefined
  ) {
    assert_true(this.inFlush, 'Not in a flush.');
    this.createRejectReactionStatement.run(
      futureId,
      this.currentMark,
      nextFutureId,
      methodId ?? null
    );
  }

  public getRejectReactions(futureId: FutureIdDb): {
    nextFutureId: FutureIdDb;
    methodId: MethodIdDb | null;
  }[] {
    return this.getRejectReactionsStatement.all(futureId) as {
      nextFutureId: FutureIdDb;
      methodId: MethodIdDb | null;
    }[];
  }

  public deleteRejectReactions(futureId: FutureIdDb) {
    assert_true(this.inFlush, 'Not in a flush.');
    this.deleteRejectReactionsStatement.run(futureId);
  }

  public getAndMarkRejectReactions(futureIds: FutureIdDb[]): {
    nextFutureId: FutureIdDb;
    methodId: MethodIdDb | null;
  }[] {
    return this.getAndMarkReactionsImpl(
      this.getAndMarkRejectReactionsStatement,
      futureIds
    );
  }

  // Methods for "objects" table.

  public getNextObjectId(): ObjectIdDb {
    assert_true(this.inFlush, 'Not in a flush.');
    const result = this.getNextObjectIdStatement.get() as {
      objectIdCount: number;
    };
    return result.objectIdCount - 1;
  }

  public createObject(id: ObjectIdDb, type: SQLObjectType, object: unknown) {
    assert_true(this.inFlush, 'Not in a flush.');
    this.createObjectStatement.run(
      this.currentMark,
      id,
      type,
      JSON.stringify(object)
    );
  }

  public updateObject(id: ObjectIdDb, value: unknown) {
    assert_true(this.inFlush, 'Not in a flush.');
    this.updateObjectStatement.run(JSON.stringify(value), id);
  }

  public getObject(id: ObjectIdDb): {
    type: SQLObjectType;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
  } {
    const { type, value } = this.getObjectStatement.get(id) as {
      type: SQLObjectType;
      value: string;
    };
    return {
      type,
      value: JSON.parse(value),
    };
  }

  public deleteObject(id: ObjectIdDb) {
    assert_true(this.inFlush, 'Not in a flush.');
    this.deleteObjectStatement.run(id);
  }

  public getAndMarkObjects(ids: ObjectIdDb[]): {
    type: SQLObjectType;
    value: string;
  }[] {
    return this.getAndMarkObjectsStatement.all(
      this.currentMark,
      this.currentMark,
      JSON.stringify(ids)
    ) as {
      type: SQLObjectType;
      value: string;
    }[];
  }

  public objectsHasId(id: ObjectIdDb): boolean {
    const [hasId] = Object.values(this.objectsHasIdStatement.get(id)!);
    return hasId === 1;
  }

  // Test functions

  public getReactionsCountForTesting(): number {
    return (
      this.getReactionsCountForTestingStatement.get() as {
        count: number;
      }
    ).count;
  }

  public getFuturesCountForTesting(): number {
    return (
      this.getFuturesCountForTestingStatement.get() as {
        count: number;
      }
    ).count;
  }

  public getMethodsCountForTesting(): number {
    return (
      this.getMethodsCountForTestingStatement.get() as {
        count: number;
      }
    ).count;
  }

  public getObjectsCountForTesting(): number {
    return (
      this.getObjectsCountForTestingStatement.get() as {
        count: number;
      }
    ).count;
  }

  // Methods for conversion

  public toBooleanDb(bool: boolean) {
    return bool ? BooleanDb.True : BooleanDb.False;
  }

  public fromBooleanDb(bool: BooleanDb) {
    return bool === BooleanDb.True;
  }

  public toMethodTypeDb(type: MethodType): MethodTypeDb {
    switch (type) {
      case MethodType.External:
        return MethodTypeDb.External;
      case MethodType.Internal:
        return MethodTypeDb.Internal;
    }
  }

  public fromMethodTypeDb(type: MethodTypeDb): MethodType {
    switch (type) {
      case MethodTypeDb.External:
        return MethodType.External;
      case MethodTypeDb.Internal:
        return MethodType.Internal;
    }
  }

  public toFutureIdDb<T extends SerializableDB>(
    futureId: FutureId<FromSerializableDB<T>>
  ): FutureIdDb | undefined {
    return futureId.split('-')[1];
  }

  public fromFutureIdDb<T extends SerializableDB>(
    futureIdDb: FutureIdDb
  ): FutureId<FromSerializableDB<T>> {
    return `future-${futureIdDb}` as FutureId<FromSerializableDB<T>>;
  }

  private toFutureStateDb(futureState: FutureState): FutureStateDb {
    switch (futureState) {
      case FutureState.Fulfilled:
        return FutureStateDb.Fulfilled;
      case FutureState.Pending:
        return FutureStateDb.Pending;
      case FutureState.Rejected:
        return FutureStateDb.Rejected;
    }
  }

  private fromFutureStateDb(futureState: FutureStateDb): FutureState {
    switch (futureState) {
      case FutureStateDb.Fulfilled:
        return FutureState.Fulfilled;
      case FutureStateDb.Pending:
        return FutureState.Pending;
      case FutureStateDb.Rejected:
        return FutureState.Rejected;
    }
  }

  public toBoundedDb(
    bounded: {
      valueType: ValueType;
      value: string;
    }[]
  ): string {
    return JSON.stringify(bounded);
  }

  public fromBoundedDb(boundedDb: string): {
    valueType: ValueType;
    value: string;
  }[] {
    return JSON.parse(boundedDb);
  }
}
