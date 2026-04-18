import type { FutureDatabase } from '@futuremachine/core';
import type { TestContext } from 'node:test';

export interface DBHolder {
  createDbInstance(): Promise<FutureDatabase>;
  addCleanup(t: TestContext): Promise<void>;
  isEmpty(database: FutureDatabase): Promise<boolean>;
  close(database: FutureDatabase): Promise<void>;
  flush(database: FutureDatabase): Promise<void>;
}

export interface TestSettings {
  createDbHolder(): Promise<DBHolder>;
}
