import { strict as assert } from 'node:assert';
import readline from 'node:readline';
import { ExecutorBase } from './executor_base.js';
import { FutureExecutor } from './executors/future_executor.js';
import { PromiseExecutor } from './executors/promise_executor.js';
import { FuzzerPlan } from './fuzzer_plan.js';
import { RandGenXorshift } from './rand_gen_xorshift.js';

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

async function fuzz(seed: number) {
  const randGen = new RandGenXorshift(seed);
  const plan = new FuzzerPlan(randGen, 200);

  const promiseExecutor = new ExecutorBase(new PromiseExecutor());
  const futureExecutor = new ExecutorBase(new FutureExecutor());

  const promiseEvents = await promiseExecutor.run(plan);
  const futureEvents = await futureExecutor.run(plan);

  // TODO: it doesn't seem like it matters if this runs or not. That probably
  // means we're not getting as much test coverage as before.
  visit([AggregateErrorVisitor, AllSettledVisitor], futureEvents);

  assert.deepStrictEqual(futureEvents, promiseEvents);
}

async function run() {
  const start = Date.now();
  const runTime = 10 * 60 * 1000;
  let curTime = start;

  while (curTime - start < runTime) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`${runTime - (curTime - start)}ms`);
    const seed = Math.random();
    try {
      await fuzz(seed);
    } catch (e) {
      console.log('\nFailure');
      console.error(e);
      console.log(`Seed: ${seed}`);
      process.exit(1);
    }
    curTime = Date.now();
  }
  console.log('\nSuccess');
  console.log('All seeds passed');
}

await run();
