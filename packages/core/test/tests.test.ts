import type { TestContext } from 'node:test';
import { SimpleFutureDatabase, type FutureDatabase } from '../src/index.js';
import { runTests, type DBHolder } from './export_tests.js';
import { assertFutureDatabaseEmpty } from './test_helpers.js';

class SimpleDBHolder implements DBHolder {
  futureDatabase = new SimpleFutureDatabase();

  public async createDbInstance(): Promise<FutureDatabase> {
    return this.futureDatabase;
  }
  public async addCleanup(_t: TestContext): Promise<void> {}
  public close(database: SimpleFutureDatabase): Promise<void> {
    return database.close();
  }
  public async assertEmpty(): Promise<void> {
    assertFutureDatabaseEmpty(this.futureDatabase);
  }
  public flush(database: SimpleFutureDatabase): Promise<void> {
    return database.flush();
  }
}

runTests({
  async createDbHolder() {
    return new SimpleDBHolder();
  },
});
