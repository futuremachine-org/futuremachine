import type { TestContext } from 'node:test';
import type { FutureDatabase } from '../src/index.js';
import container from './suites/container.js';
import exception from './suites/exception.js';
import future from './suites/future.js';
import future_machine from './suites/future_machine.js';
import method from './suites/method.js';
import primitives from './suites/primitives.js';

export interface DBHolder {
  createDbInstance(): Promise<FutureDatabase>;
  addCleanup(t: TestContext): Promise<void>;
  // TODO: Change this to isEmpty() and create an assert.
  assertEmpty(database: FutureDatabase): Promise<void>;
  close(database: FutureDatabase): Promise<void>;
  flush(database: FutureDatabase): Promise<void>;
}

export interface TestSettings {
  createDbHolder(): Promise<DBHolder>;
}

// TODO: Figure out naming for: this function, this file name, the tests.test.ts
// file name.
export function runTests(testSettings: TestSettings) {
  container(testSettings);
  future_machine(testSettings);
  future(testSettings);
  method(testSettings);
  primitives(testSettings);
  exception(testSettings);
}
