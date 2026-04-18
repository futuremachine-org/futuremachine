import container from './suites/container.js';
import exception from './suites/exception.js';
import future from './suites/future.js';
import future_machine from './suites/future_machine.js';
import method from './suites/method.js';
import primitives from './suites/primitives.js';
import type { TestSettings } from './test_settings.js';
export type { DBHolder, TestSettings } from './test_settings.js';

export function runConformanceTests(testSettings: TestSettings) {
  container(testSettings);
  future_machine(testSettings);
  future(testSettings);
  method(testSettings);
  primitives(testSettings);
  exception(testSettings);
}
