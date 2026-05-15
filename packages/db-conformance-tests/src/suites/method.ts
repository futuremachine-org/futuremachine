import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import type { Future, FutureId, List } from '@futuremachine/core';
import { createFutureMachine, Method } from '@futuremachine/core';
import { createMethod } from '../test_helpers.js';
import type { TestSettings } from '../test_settings.js';

export default (testSettings: TestSettings) => {
  describe('Method', () => {
    describe('name', () => {
      test('the name returned by name() is the same as what the method was created with', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

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
        const { methods } = createFutureMachine(futureDatabase);

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
        const { methods } = createFutureMachine(futureDatabase);

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
        const { methods } = createFutureMachine(futureDatabase);

        const method = methods.create(
          'My Method',
          (value1: number, value2: string) => {
            return `${value1}: ${value2}`;
          }
        );
        methods.build();

        assert.deepStrictEqual(method(1, 'Hello'), '1: Hello');

        const boundedMethod = method.bindArgs(2);

        assert.deepStrictEqual(boundedMethod('world'), '2: world');

        const fullyBoundedMethod = boundedMethod.bindArgs('fizz');

        assert.deepStrictEqual(fullyBoundedMethod(), '2: fizz');

        const fullyBoundedMethod2 = method.bindArgs(3, 'buzz');

        assert.deepStrictEqual(fullyBoundedMethod2(), '3: buzz');
        await dbHolder.close(futureDatabase);
      });

      test('can bind Method to a Method', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

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
        const futures = methods.build();

        const { future, resolve: futureResolve } =
          futures.withResolvers<number>();

        future.next(method.bindArgs(callbackMethod));

        const result = 4343;
        futureResolve(result);
        assert.strictEqual(await promise, result);
        await dbHolder.close(futureDatabase);
      });

      test('can bind Method to a Method recursively', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

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
        const futures = methods.build();

        const { future, resolve: futureResolve } =
          futures.withResolvers<number>();

        future.next(
          method.bindArgs(method.bindArgs(method.bindArgs(callbackMethod)))
        );

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
          const { methods } = createFutureMachine(futureDatabase);

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
            futures: methods.build(),
            method,
            promise,
            callbackMethod,
          };
        }

        let futureId: FutureId<number>;

        {
          const { futureDatabase, futures, method, callbackMethod } =
            await createMethods();
          const { future, id } = futures.withResolvers<number>();
          futureId = id;
          future.next(
            method.bindArgs(method.bindArgs(method.bindArgs(callbackMethod)))
          );
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futures, promise } = await createMethods();
          const result = 4343;
          futures.resolveFutureById(futureId, result);
          assert.strictEqual(await promise, result);
          await dbHolder.close(futureDatabase);
        }
      });

      test('future next can call a bounded method', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createFutureMachine(futureDatabase);

        const method = methods.create(
          'My Method',
          (value1: number, value2: string): List<[number, string]> => {
            return containers.list.create(value1, value2);
          }
        );

        const { method: method2, promise: promise2 } =
          createMethod<List<[number, string]>>(methods);

        const { method: method3, promise: promise3 } =
          createMethod<List<[number, string]>>(methods);

        const futures = methods.build();

        {
          const { future, resolve } = futures.withResolvers<string>();

          future.next(method.bindArgs(1)).next(method2);

          resolve('Hello');

          assert.deepStrictEqual([...(await promise2)], [1, 'Hello']);
        }

        {
          const { future, resolve } = futures.withResolvers();

          future.next(method.bindArgs(2, 'World')).next(method3);

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
          const { methods } = createFutureMachine(futureDatabase);

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
            futures: methods.build(),
            method,
            promise,
            callbackMethod,
          };
        }

        let futureId: FutureId<void>;
        let boundedFutureId: FutureId<number>;

        {
          const { futureDatabase, futures, method, callbackMethod } =
            await createMethods();
          const { future, id } = futures.withResolvers<void>();
          futureId = id;
          const { future: boundFuture, id: boundedId } =
            futures.withResolvers<number>();
          boundedFutureId = boundedId;
          future.next(method.bindArgs(boundFuture, callbackMethod));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futures, promise } = await createMethods();
          const result = 4343;
          futures.resolveFutureById(boundedFutureId, result);
          futures.resolveFutureById(futureId);
          assert.strictEqual(await promise, result);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can bind Futures returned from Future.resolve to Methods across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

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
            futures: methods.build(),
            method,
            promise,
            callbackMethod,
          };
        }

        let futureId: FutureId<void>;
        const result = 4343;

        {
          const { futureDatabase, futures, method, callbackMethod } =
            await createMethods();
          const { future, id } = futures.withResolvers<void>();
          futureId = id;
          const boundFuture = futures.resolve<number>(result);
          future.next(method.bindArgs(boundFuture, callbackMethod));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futures, promise } = await createMethods();
          futures.resolveFutureById(futureId);
          assert.strictEqual(await promise, result);
          await dbHolder.close(futureDatabase);
        }
      });

      test('the same instance of a Method is always returned for the same session until garbage collection', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Method<() => void>>();
        const holder = methods.create(
          'holder',
          (method: Method<() => void>) => {
            resolve(method);
          }
        );

        const method = methods.create('method', () => {});

        const futures = methods.build();

        const { future, id } = futures.withResolvers<void>();

        future.next(holder.bindArgs(method));

        futures.resolveFutureById(id);

        const heldMethod = await promise;

        assert.strictEqual(heldMethod, method);

        await dbHolder.close(futureDatabase);
      });

      test('the same instance of a bound Method is always returned for the same session until garbage collection', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Method<() => void>>();
        const holder = methods.create(
          'holder',
          (method: Method<() => void>) => {
            resolve(method);
          }
        );

        const method = methods.create('method', (_num: number) => {});

        const futures = methods.build();

        const { future, id } = futures.withResolvers<void>();

        const boundMethod = method.bindArgs(1);

        future.next(holder.bindArgs(boundMethod));

        futures.resolveFutureById(id);

        const heldBoundMethod = await promise;

        assert.strictEqual(heldBoundMethod, boundMethod);

        await dbHolder.close(futureDatabase);
      });

      test('the same instance of an unbound Method is always the same as the original Method', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Method<() => void>>();
        const holder = methods.create(
          'holder',
          (method: Method<() => void>) => {
            resolve(method);
          }
        );

        const method = methods.create('method', () => {});

        const futures = methods.build();

        const { future, id } = futures.withResolvers<void>();

        future.next(holder.bindArgs(method));

        futures.resolveFutureById(id);

        const heldMethod = await promise;

        assert.strictEqual(heldMethod, method);

        await dbHolder.close(futureDatabase);
      });

      test.only('the same instance of an unbound Method is always the same as the original Method across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Method<() => void>>();
          const holder = methods.create(
            'holder',
            (method: Method<() => void>) => {
              resolve(method);
            }
          );

          const method = methods.create('method', () => {});

          const futures = methods.build();

          return { promise, holder, method, futures, futureDatabase };
        }

        let futureId: FutureId<void>;

        {
          const { holder, method, futures, futureDatabase } =
            await createMethods();
          const { future, id } = futures.withResolvers<void>();
          futureId = id;

          future.next(holder.bindArgs(method));

          await dbHolder.close(futureDatabase);
        }

        {
          const { promise, method, futures, futureDatabase } =
            await createMethods();

          futures.resolveFutureById(futureId);

          const heldBoundMethod = await promise;

          assert.strictEqual(heldBoundMethod, method);

          await dbHolder.close(futureDatabase);
        }
      });
    });
  });
};
