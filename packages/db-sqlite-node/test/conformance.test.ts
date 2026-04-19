import { GetFutureDatabase, type FutureDatabase } from '@futuremachine/core';
import {
  runConformanceTests,
  type DBHolder,
} from '@futuremachine/db-conformance-tests';
import type { TestContext } from 'node:test';
import { SQLFutureDatabase } from '../src/sql_future_database.js';
import { cleanupDbFiles, randomDatabasePath } from './test_helpers.js';

class SQLDBHolder implements DBHolder {
  private dbPath = randomDatabasePath();
  public async createDbInstance(): Promise<FutureDatabase> {
    return new SQLFutureDatabase(this.dbPath);
  }
  public async addCleanup(t: TestContext): Promise<void> {
    t.after(() => {
      cleanupDbFiles(this.dbPath);
    });
  }
  public async isEmpty(database: SQLFutureDatabase): Promise<boolean> {
    await database.gc();
    if (database[GetFutureDatabase]().getFuturesCountForTesting() !== 0) {
      return false;
    }

    if (database[GetFutureDatabase]().getReactionsCountForTesting() !== 0) {
      return false;
    }

    if (database[GetFutureDatabase]().getMethodsCountForTesting() !== 0) {
      return false;
    }

    if (database[GetFutureDatabase]().getObjectsCountForTesting() !== 0) {
      return false;
    }
    return true;
  }
  public async close(database: SQLFutureDatabase): Promise<void> {
    await database.gc();
    await database.close();
  }
  public flush(database: SQLFutureDatabase): Promise<void> {
    return database.flush();
  }
}

runConformanceTests({
  async createDbHolder() {
    return new SQLDBHolder();
  },
});
