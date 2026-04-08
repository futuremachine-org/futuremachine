import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { createMethodMachine, SimpleFutureDatabase } from '../src/index.js';

describe('FutureMachineDBTools', () => {
  describe('onDone', () => {
    test("Promise returned resolves when there's no ongoing calls", async () => {
      const futureDatabase = new SimpleFutureDatabase();
      const { methods } = createMethodMachine(futureDatabase);

      const futureMachine = methods.build();

      const { future: f1, resolve: r1 } = futureMachine.withResolvers<number>();
      const { future: f2, resolve: r2 } = futureMachine.withResolvers<number>();
      const { future: f3, resolve: r3 } = futureMachine.withResolvers<number>();
      const { future: f4, resolve: r4 } = futureMachine.withResolvers<number>();
      const { future: f5, resolve: r5 } = futureMachine.withResolvers<number>();

      const result = 5;

      r1(f2);
      r2(f3);
      r3(f4);
      r4(f5);
      r5(result);

      // flush() calls FutureMachineDBTools.onDone
      await futureDatabase.flush();

      assert.strictEqual(
        await Promise.race([f1.getPromise(), Promise.resolve()]),
        result
      );
    });

    test("Promise returned is already resolved if there's no ongoing calls", async () => {
      const futureDatabase = new SimpleFutureDatabase();
      const { methods } = createMethodMachine(futureDatabase);

      methods.build();

      const result = 5;

      // flush() calls FutureMachineDBTools.onDone
      assert.notEqual(
        await Promise.race([futureDatabase.flush(), Promise.resolve(result)]),
        result
      );
    });

    test("Promise returned resolves when there's no ongoing calls even if we call onDone again", async () => {
      const futureDatabase = new SimpleFutureDatabase();
      const { methods } = createMethodMachine(futureDatabase);

      const futureMachine = methods.build();

      const { future: f1, resolve: r1 } = futureMachine.withResolvers<number>();
      const { future: f2, resolve: r2 } = futureMachine.withResolvers<number>();
      const { future: f3, resolve: r3 } = futureMachine.withResolvers<number>();
      const { future: f4, resolve: r4 } = futureMachine.withResolvers<number>();
      const { future: f5, resolve: r5 } = futureMachine.withResolvers<number>();

      const result = 5;

      r1(f2);
      r2(f3);
      r3(f4);
      r4(f5);
      r5(result);

      // flush() calls FutureMachineDBTools.onDone
      const flushPromise = futureDatabase.flush();
      futureDatabase.flush();

      await flushPromise;

      assert.strictEqual(
        await Promise.race([f1.getPromise(), Promise.resolve()]),
        result
      );
    });
  });
});
