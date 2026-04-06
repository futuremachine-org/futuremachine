import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import type { FutureId } from '../src/core/future_impl.js';
import { createMethodMachine } from '../src/core/future_machine.js';
import {
  SimpleFutureDatabase,
  type SimpleFutureDatabaseState,
} from '../src/database/simple_future_database.js';
import { GetFutureDatabase } from '../src/symbols.js';

describe('SimpleFutureDatabase', () => {
  test("flush is a no-op if it hasn't been passed to a MethodMachine constructor yet", async () => {
    const futureDatabase = new SimpleFutureDatabase();
    await futureDatabase.flush();
  });

  test('can be loaded from a saved state', async () => {
    let futureDatabaseState: SimpleFutureDatabaseState | undefined;

    async function createMethods() {
      const futureDatabase = new SimpleFutureDatabase(futureDatabaseState);
      const { methods } = createMethodMachine(futureDatabase);

      const { promise, resolve } = Promise.withResolvers<number>();
      const method = methods.create('method', (value: number) => {
        resolve(value);
      });
      const futureMachine = methods.build();

      return { futureDatabase, method, futureMachine, promise };
    }

    const value = 123;

    let futureId: FutureId<void>;

    {
      const { futureDatabase, method, futureMachine } = await createMethods();
      const { future, id } = futureMachine.withResolvers<void>();
      futureId = id;

      future.next(method.bind(value));
      await futureDatabase.flush();
      futureDatabaseState = futureDatabase.getState();
    }

    {
      const { futureDatabase, futureMachine, promise } = await createMethods();
      futureMachine.resolveFutureById(futureId);

      assert.strictEqual(await promise, value);
      await futureDatabase.flush();
    }
  });

  test('dot tool related functions, getFutureIds and getReactions, report the correct information', async () => {
    const futureDatabase = new SimpleFutureDatabase();
    const { methods } = createMethodMachine(futureDatabase);

    const method = methods.create('method', () => {});

    const futureMachine = methods.build();

    const { id: id1, future: f1 } = futureMachine.withResolvers<number>();
    const { id: id2 } = futureMachine.withResolvers<number>();
    const { id: id3 } = futureMachine.withResolvers<number>();
    const { id: id4 } = futureMachine.withResolvers<number>();
    const { id: id5 } = futureMachine.withResolvers<number>();

    f1.next(method);

    const futureIds = futureDatabase[GetFutureDatabase]().getFutureIds();

    // 5 from `withResolvers` and 1 from `next`.
    assert.strictEqual(futureIds.length, 6);

    assert.strictEqual(futureIds[0]!, id1);
    assert.strictEqual(futureIds[1]!, id2);
    assert.strictEqual(futureIds[2]!, id3);
    assert.strictEqual(futureIds[3]!, id4);
    assert.strictEqual(futureIds[4]!, id5);

    const f1Reactions = futureDatabase[GetFutureDatabase]().getReactions(id1);

    // `next` created both fulfill and reject reactions for `f1`.
    assert.strictEqual(f1Reactions.fulfillReactions.length, 1);
    assert.strictEqual(f1Reactions.rejectReactions.length, 1);

    await futureDatabase.flush();
  });
});
