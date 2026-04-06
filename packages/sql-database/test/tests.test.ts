import { GetFutureDatabase, type FutureDatabase } from '@futuremachine/core';
import { runTests, type DBHolder } from '@futuremachine/core/testing';
import { strict as assert } from 'node:assert';
import type { TestContext } from 'node:test';
import { SQLFutureDatabase } from '../src/sql_future_database.js';
import { cleanupDbFiles, randomDatabasePath } from './test_helpers.js';

class SQLDBHolder implements DBHolder {
  dbPath = randomDatabasePath();
  async createDbInstance(): Promise<FutureDatabase> {
    return new SQLFutureDatabase(this.dbPath);
  }
  async addCleanup(t: TestContext): Promise<void> {
    t.after(() => {
      cleanupDbFiles(this.dbPath);
    });
  }
  async assertEmpty(database: SQLFutureDatabase): Promise<void> {
    await database.gc();
    assert.strictEqual(
      database[GetFutureDatabase]().getFuturesCountForTesting(),
      0
    );
    assert.strictEqual(
      database[GetFutureDatabase]().getReactionsCountForTesting(),
      0
    );
    assert.strictEqual(
      database[GetFutureDatabase]().getMethodsCountForTesting(),
      0
    );
    assert.strictEqual(
      database[GetFutureDatabase]().getObjectsCountForTesting(),
      0
    );
  }
  close(database: SQLFutureDatabase): Promise<void> {
    return database.gc().then(() => database.close());
  }
  flush(database: SQLFutureDatabase): Promise<void> {
    return database.flush();
  }
}

runTests({
  async createDbHolder() {
    return new SQLDBHolder();
  },
});
