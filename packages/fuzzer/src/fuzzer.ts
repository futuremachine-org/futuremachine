import { strict as assert } from 'node:assert';
import { ExecutorBase } from './executor_base.js';
import { FutureExecutor } from './executors/future_executor.js';
import { PromiseExecutor } from './executors/promise_executor.js';
import { FuzzerPlan } from './fuzzer_plan.js';
import { RandGenXorshift } from './rand_gen_xorshift.js';

const seed = Math.random();
console.log(`Seed: ${seed}`);
const randGen = new RandGenXorshift(seed);
const plan = new FuzzerPlan(randGen, 100);
const promiseExecutor = new ExecutorBase(new PromiseExecutor());
await promiseExecutor.run(plan);
const futureExecutor = new ExecutorBase(new FutureExecutor());
await futureExecutor.run(plan);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VisitorObject = Record<string, any>;

interface Visitor {
  visit<T extends VisitorObject>(obj: T, key: keyof T): void;
}

function visit(visitors: Visitor[], obj: VisitorObject) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    for (const visitor of visitors) {
      visitor.visit(obj, key);
    }
    if (value !== null && typeof value === 'object') {
      visit(visitors, value as VisitorObject);
    }
  }
}

const AggregateErrorVisitor: Visitor = {
  visit<T extends VisitorObject>(obj: T, key: keyof T): void {
    if (
      (obj[key] as unknown) instanceof Error &&
      obj[key].message === 'All futures were rejected'
    ) {
      obj[key].message = 'All promises were rejected';
    }
  },
};

const AllSettledVisitor: Visitor = {
  visit<T extends VisitorObject>(obj: T, key: keyof T): void {
    if (obj[key] === null || typeof obj[key] !== 'object') {
      return;
    }
    const allSettledResult = obj[key] as {
      status_: 'fulfilled' | 'rejected' | undefined;
      value_: unknown;
    };
    if (allSettledResult.status_ === 'fulfilled') {
      (obj[key] as PromiseSettledResult<unknown>) = {
        status: allSettledResult.status_,
        value: allSettledResult.value_,
      };
    }
    if (allSettledResult.status_ === 'rejected') {
      (obj[key] as PromiseSettledResult<unknown>) = {
        status: allSettledResult.status_,
        reason: allSettledResult.value_,
      };
    }
  },
};

const futureEvents = futureExecutor.getEvents();
visit([AggregateErrorVisitor, AllSettledVisitor], futureEvents);

console.log(`Seed: ${seed}`);
assert.deepStrictEqual(futureEvents, promiseExecutor.getEvents());
