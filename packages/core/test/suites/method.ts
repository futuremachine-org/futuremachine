import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { List } from '../../src/containers/list.js';
import type { Future } from '../../src/core/future.js';
import type { FutureId } from '../../src/core/future_impl.js';
import { createMethodMachine } from '../../src/core/future_machine.js';
import { Method } from '../../src/core/method.js';
import type { TestSettings } from '../export_tests.js';
import { createMethod } from '../test_helpers.js';

export default (testSettings: TestSettings) => {
  describe('Method', () => {
    describe('name', () => {
      test('the name returned by name() is the same as what the method was created with', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const methodName = 'My Method';
        const method = methods.create(methodName, () => {});
        assert.strictEqual(method.name(), methodName);
        await dbHolder.close(futureDatabase);
      });
    });
    describe('impl', () => {
      test('constructor works as expected', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const method = methods.create('method', () => {});

        // By default is `Struct`.
        assert.strictEqual(method.constructor, Method);

        // Can be set.
        method.constructor = Object;
        assert.strictEqual(method.constructor, Object);

        await dbHolder.close(futureDatabase);
      });
      test('preserves the generics of functions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const method = methods.create(
          'method with generics',
          <T>(firstArg: boolean, arg1: T, arg2: T): T => {
            if (firstArg) {
              return arg1;
            }
            return arg2;
          }
        );

        assert.strictEqual(method(true, 1, 2), 1);
        assert.strictEqual(method(false, 'Hello', 'world!'), 'world!');

        // TODO: Create type tests.

        // Doesn't work:
        // method(true, 1,  "world!")
        await dbHolder.close(futureDatabase);
      });
    });
    describe('bind', () => {
      test('can bind values to a Method', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const method = methods.create(
          'My Method',
          (value1: number, value2: string) => {
            return `${value1}: ${value2}`;
          }
        );
        methods.build();

        assert.deepStrictEqual(method(1, 'Hello'), '1: Hello');

        const boundedMethod = method.bind(2);

        assert.deepStrictEqual(boundedMethod('world'), '2: world');

        const fullyBoundedMethod = boundedMethod.bind('fizz');

        assert.deepStrictEqual(fullyBoundedMethod(), '2: fizz');

        const fullyBoundedMethod2 = method.bind(3, 'buzz');

        assert.deepStrictEqual(fullyBoundedMethod2(), '3: buzz');
        await dbHolder.close(futureDatabase);
      });

      test('can bind Method to a Method', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const method = methods.create(
          'My Method',
          (callback: Method<(value: number) => void>, value: number) => {
            callback(value);
          }
        );

        const { promise, resolve: promiseResolve } =
          Promise.withResolvers<number>();
        const callbackMethod = methods.create(
          'callbackMethod',
          (value: number) => {
            promiseResolve(value);
          }
        );
        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<number>();

        future.next(method.bind(callbackMethod));

        const result = 4343;
        futureResolve(result);
        assert.strictEqual(await promise, result);
        await dbHolder.close(futureDatabase);
      });

      test('can bind Method to a Method recursively', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const method = methods.create(
          'My Method',
          (callback: Method<(value: number) => void>, value: number) => {
            callback(value);
          }
        );

        const { promise, resolve: promiseResolve } =
          Promise.withResolvers<number>();
        const callbackMethod = methods.create(
          'callbackMethod',
          (value: number) => {
            promiseResolve(value);
          }
        );
        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<number>();

        future.next(method.bind(method.bind(method.bind(callbackMethod))));

        const result = 4343;
        futureResolve(result);
        assert.strictEqual(await promise, result);
        await dbHolder.close(futureDatabase);
      });

      test('can bind Method to a Method recursively across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const method = methods.create(
            'My Method',
            (callback: Method<(value: number) => void>, value: number) => {
              callback(value);
            }
          );

          const { promise, resolve: promiseResolve } =
            Promise.withResolvers<number>();
          const callbackMethod = methods.create(
            'callbackMethod',
            (value: number) => {
              promiseResolve(value);
            }
          );
          return {
            futureDatabase,
            futureMachine: methods.build(),
            method,
            promise,
            callbackMethod,
          };
        }

        let futureId: FutureId<number>;

        {
          const { futureDatabase, futureMachine, method, callbackMethod } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<number>();
          futureId = id;
          future.next(method.bind(method.bind(method.bind(callbackMethod))));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          const result = 4343;
          futureMachine.resolveFutureById(futureId, result);
          assert.strictEqual(await promise, result);
          await dbHolder.close(futureDatabase);
        }
      });

      test('future next can call a bounded method', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const method = methods.create(
          'My Method',
          (value1: number, value2: string): List<[number, string]> => {
            return containers.createList(value1, value2);
          }
        );

        const { method: method2, promise: promise2 } =
          createMethod<List<[number, string]>>(methods);

        const { method: method3, promise: promise3 } =
          createMethod<List<[number, string]>>(methods);

        const futureMachine = methods.build();

        {
          const { future, resolve } = futureMachine.withResolvers<string>();

          future.next(method.bind(1)).next(method2);

          resolve('Hello');

          assert.deepStrictEqual([...(await promise2)], [1, 'Hello']);
        }

        {
          const { future, resolve } = futureMachine.withResolvers();

          future.next(method.bind(2, 'World')).next(method3);

          resolve('Hello');

          assert.deepStrictEqual([...(await promise3)], [2, 'World']);
        }
        await dbHolder.close(futureDatabase);
      });

      test('can bind Futures to Methods across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const method = methods.create(
            'My Method',
            (
              future: Future<number>,
              callback: Method<(value: number) => void>
            ) => {
              future.next(callback);
            }
          );

          const { promise, resolve: promiseResolve } =
            Promise.withResolvers<number>();
          const callbackMethod = methods.create(
            'callbackMethod',
            (value: number) => {
              promiseResolve(value);
            }
          );
          return {
            futureDatabase,
            futureMachine: methods.build(),
            method,
            promise,
            callbackMethod,
          };
        }

        let futureId: FutureId<void>;
        let boundedFutureId: FutureId<number>;

        {
          const { futureDatabase, futureMachine, method, callbackMethod } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;
          const { future: boundFuture, id: boundedId } =
            futureMachine.withResolvers<number>();
          boundedFutureId = boundedId;
          future.next(method.bind(boundFuture, callbackMethod));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          const result = 4343;
          futureMachine.resolveFutureById(boundedFutureId, result);
          futureMachine.resolveFutureById(futureId);
          assert.strictEqual(await promise, result);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can bind Futures returned from Future.resolve to Methods across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const method = methods.create(
            'My Method',
            (
              future: Future<number>,
              callback: Method<(value: number) => void>
            ) => {
              future.next(callback);
            }
          );

          const { promise, resolve: promiseResolve } =
            Promise.withResolvers<number>();
          const callbackMethod = methods.create(
            'callbackMethod',
            (value: number) => {
              promiseResolve(value);
            }
          );
          return {
            futureDatabase,
            futureMachine: methods.build(),
            method,
            promise,
            callbackMethod,
          };
        }

        let futureId: FutureId<void>;
        const result = 4343;

        {
          const { futureDatabase, futureMachine, method, callbackMethod } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;
          const boundFuture = futureMachine.resolve<number>(result);
          future.next(method.bind(boundFuture, callbackMethod));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);
          assert.strictEqual(await promise, result);
          await dbHolder.close(futureDatabase);
        }
      });

      test('the same instance of a Method is always returned for the same session until garbage collection', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Method<() => void>>();
        const holder = methods.create(
          'holder',
          (method: Method<() => void>) => {
            resolve(method);
          }
        );

        const method = methods.create('method', () => {});

        const futureMachine = methods.build();

        const { future, id } = futureMachine.withResolvers<void>();

        future.next(holder.bind(method));

        futureMachine.resolveFutureById(id);

        const heldMethod = await promise;

        assert.strictEqual(heldMethod, method);

        await dbHolder.close(futureDatabase);
      });

      test('the same instance of a bound Method is always returned for the same session until garbage collection', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Method<() => void>>();
        const holder = methods.create(
          'holder',
          (method: Method<() => void>) => {
            resolve(method);
          }
        );

        const method = methods.create('method', (_num: number) => {});

        const futureMachine = methods.build();

        const { future, id } = futureMachine.withResolvers<void>();

        const boundMethod = method.bind(1);

        future.next(holder.bind(boundMethod));

        futureMachine.resolveFutureById(id);

        const heldBoundMethod = await promise;

        assert.strictEqual(heldBoundMethod, boundMethod);

        await dbHolder.close(futureDatabase);
      });

      test('the same instance of an unbound Method is always the same as the original Method', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Method<() => void>>();
        const holder = methods.create(
          'holder',
          (method: Method<() => void>) => {
            resolve(method);
          }
        );

        const method = methods.create('method', () => {});

        const futureMachine = methods.build();

        const { future, id } = futureMachine.withResolvers<void>();

        future.next(holder.bind(method));

        futureMachine.resolveFutureById(id);

        const heldMethod = await promise;

        assert.strictEqual(heldMethod, method);

        await dbHolder.close(futureDatabase);
      });

      test.only('the same instance of an unbound Method is always the same as the original Method across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Method<() => void>>();
          const holder = methods.create(
            'holder',
            (method: Method<() => void>) => {
              resolve(method);
            }
          );

          const method = methods.create('method', () => {});

          const futureMachine = methods.build();

          return { promise, holder, method, futureMachine, futureDatabase };
        }

        let futureId: FutureId<void>;

        {
          const { holder, method, futureMachine, futureDatabase } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          future.next(holder.bind(method));

          await dbHolder.close(futureDatabase);
        }

        {
          const { promise, method, futureMachine, futureDatabase } =
            await createMethods();

          futureMachine.resolveFutureById(futureId);

          const heldBoundMethod = await promise;

          assert.strictEqual(heldBoundMethod, method);

          await dbHolder.close(futureDatabase);
        }
      });
    });
  });
};
