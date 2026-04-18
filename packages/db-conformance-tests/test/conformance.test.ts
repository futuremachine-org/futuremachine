import { SimpleFutureDatabase, type FutureDatabase } from '@futuremachine/core';
import type { TestContext } from 'node:test';
import { runConformanceTests, type DBHolder } from '../src/index.js';
import { isFutureDatabaseEmpty } from '../src/test_helpers.js';

class SimpleDBHolder implements DBHolder {
  futureDatabase = new SimpleFutureDatabase();

  public async createDbInstance(): Promise<FutureDatabase> {
    return this.futureDatabase;
  }
  public async addCleanup(_t: TestContext): Promise<void> {}
  public close(database: SimpleFutureDatabase): Promise<void> {
    return database.close();
  }
  public async isEmpty(): Promise<boolean> {
    return isFutureDatabaseEmpty(this.futureDatabase);
  }
  public flush(database: SimpleFutureDatabase): Promise<void> {
    return database.flush();
  }
}

runConformanceTests({
  async createDbHolder() {
    return new SimpleDBHolder();
  },
});
