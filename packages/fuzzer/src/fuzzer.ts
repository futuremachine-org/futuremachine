import { strict as assert } from 'node:assert';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { ExecutorBase } from './executor_base.js';
import { FutureExecutor } from './executors/future_executor.js';
import { PromiseExecutor } from './executors/promise_executor.js';
import { FuzzerPlan } from './fuzzer_plan.js';
import { RandGenXorshift } from './rand_gen_xorshift.js';

const isCI = process.env.GITHUB_ACTIONS === 'true';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VisitorObject = Record<string, any>;

// TODO: Update ExecutorBase's `run` to call visit on its events before
// returning them. `Executor` should have a visit function, and `FutureExecutor`
// should implement the visistors below.
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

async function fuzzForDuration(durationMs: number) {
  console.log(`Fuzzing for ${durationMs}ms`);
  const start = Date.now();
  let curTime = start;

  while (curTime - start < durationMs) {
    if (!isCI) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      const timeLeft = durationMs - (curTime - start);
      process.stdout.write(`Time left: ${timeLeft}ms`);
    }
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

async function fuzzWithSeed(seed: number) {
  console.log(`Running seed: ${seed}`);
  try {
    await fuzz(seed);
  } catch (e) {
    console.log('Failure');
    console.error(e);
    console.log(`Seed: ${seed}`);
    process.exit(1);
  }
  console.log('\nSuccess');
}

const defaultDurationMs = 5 * 1000;

function printHelpAndExit(exitCode: number): never {
  const helpMessage = [
    'Usage: npm run test:fuzzer -- [OPTIONS]',
    '',
    'Modes:',
    '  Default: Runs with random seeds for a specified duration.',
    '  Single:  Runs a specific seed (ignores duration).',
    '',
    'Options:',
    `  --duration-ms=N    Max time to run random seeds (default: ${defaultDurationMs}).`,
    '  --seed=N           Run a single specific seed.',
    '  -h, --help         Display this help message.',
    '',
    'Note: --seed and --duration-ms cannot be used together.',
  ].join('\n');

  console.log(helpMessage);
  process.exit(exitCode);
}

function parseCommandLineNumber(
  numberStr: string | undefined
): number | undefined {
  if (numberStr === undefined) {
    return undefined;
  }

  if (!/^\d+(\.\d+)?$/.test(numberStr)) {
    printHelpAndExit(1);
  }

  const num = Number.parseFloat(numberStr);

  if (!Number.isFinite(num)) {
    printHelpAndExit(1);
  }

  return num;
}

function getCommandLineFlags(): {
  durationMs: number | undefined;
  seed: number | undefined;
} {
  let durationMsStr: string | undefined;
  let seedStr: string | undefined;
  try {
    const { values } = parseArgs({
      options: {
        ['duration-ms']: { type: 'string' },
        seed: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });

    if (values.help) {
      printHelpAndExit(0);
    }

    durationMsStr = values['duration-ms'];
    seedStr = values.seed;
  } catch {
    printHelpAndExit(1);
  }

  if (durationMsStr !== undefined && seedStr !== undefined) {
    printHelpAndExit(1);
  }

  return {
    durationMs: parseCommandLineNumber(durationMsStr),
    seed: parseCommandLineNumber(seedStr),
  };
}

async function run() {
  const { durationMs, seed } = getCommandLineFlags();
  if (durationMs !== undefined) {
    await fuzzForDuration(durationMs);
  } else if (seed !== undefined) {
    await fuzzWithSeed(seed);
  } else {
    await fuzzForDuration(defaultDurationMs);
  }
}

await run();
