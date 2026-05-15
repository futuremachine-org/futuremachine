/* eslint-disable @typescript-eslint/explicit-member-accessibility */
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import type {
  AggregateException,
  Dictionary,
  FutureFulfilledResult,
  FutureId,
  FutureMachineAPI,
  FuturesAPI,
  FutureSettledResult,
  List,
  Serializable,
  StateBuilder,
  Struct,
} from '@futuremachine/core';
import {
  createFutureMachine,
  Entity,
  SerializableException,
} from '@futuremachine/core';
import {
  assertFutureSettledResultEquals,
  assertFutureSettledResultListEquals,
  assertIsAggregateException,
  assertPromiseRejects,
  assertPromiseRejectsWithAggregateException,
  createMethod,
  getPromiseRejectReason,
  type AnyFutureSettledResult,
} from '../test_helpers.js';
import type { TestSettings } from '../test_settings.js';

export default (testSettings: TestSettings) => {
  describe('MethodMachine', () => {
    describe('general', () => {
      test('can be bound to methods across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const methodMachine = createFutureMachine(futureDatabase);
          const { methods } = methodMachine;

          const { promise, resolve } =
            Promise.withResolvers<FutureMachineAPI>();
          const method = methods.create(
            'method',
            (methodMachine: FutureMachineAPI) => {
              resolve(methodMachine);
            }
          );

          const futures = methods.build();

          return {
            methodMachine,
            futureDatabase,
            method,
            futures,
            promise,
          };
        }

        let futureId: FutureId<void>;

        {
          const { methodMachine, futureDatabase, method, futures } =
            await createMethods();
          const { future, id } = futures.withResolvers<void>();
          futureId = id;

          future.next(method.bindArgs(methodMachine));
          await dbHolder.close(futureDatabase);
        }

        {
          const { methodMachine, futureDatabase, futures, promise } =
            await createMethods();
          futures.resolveFutureById(futureId);

          // TODO: Should we figure out how to make it strictEqual. Likely would
          // need be able to get Structs and other containers by ids.
          assert.deepStrictEqual(await promise, methodMachine);
          await dbHolder.close(futureDatabase);
        }
      });
    });
    describe('createMethod', () => {
      test("can't create methods with the same name", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        // External methods with names of internal method
        methods.create('method', () => {});
        assert.throws(() => methods.create('method', () => {}));
        await dbHolder.close(futureDatabase);
      });
      test("can't create a method with the same name as an Entity", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        class TestClass extends Entity<Record<string, never>> {}

        // External methods with names of internal method
        methods.registerEntity(
          'TestClass',
          TestClass,
          (stateBuilder: StateBuilder) => () =>
            new TestClass(stateBuilder.build({}))
        );
        assert.throws(() => methods.create('TestClass', () => {}));
        await dbHolder.close(futureDatabase);
      });
      test("external method names don't conflict with internal method names", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        // External methods with names of internal method
        methods.create('nextFinally', () => {});
        methods.create('thunk', () => {});
        methods.create('thrower', () => {});

        const { promise, resolve: promiseResolve } =
          Promise.withResolvers<void>();
        const onFinally = methods.create('onFinally', () => {
          promiseResolve();
        });

        const { method: afterFinally, promise: afterFinallyPromise } =
          createMethod<number>(methods);

        const futures = methods.build();

        const { future, resolve: futureResolve } =
          futures.withResolvers<number>();

        future.finally(onFinally).next(afterFinally);

        const result = 1234;
        futureResolve(result);
        await promise;
        assert.strictEqual(await afterFinallyPromise, result);
        await dbHolder.close(futureDatabase);
      });
    });

    describe('registerEntity', () => {
      test("can't create Entities with the same name", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        class TestClass extends Entity<Record<string, never>> {}

        // External methods with names of internal method
        methods.registerEntity(
          'TestClass',
          TestClass,
          (stateBuilder: StateBuilder) => () =>
            new TestClass(stateBuilder.build({}))
        );
        assert.throws(() =>
          methods.registerEntity(
            'TestClass',
            TestClass,
            (stateBuilder: StateBuilder) => () =>
              new TestClass(stateBuilder.build({}))
          )
        );
        await dbHolder.close(futureDatabase);
      });
      test('if you create an Entity with the same name and it throws, the original Entity with that name is still registered', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        class TestClass extends Entity<Record<string, never>> {}
        class TestClass2 extends Entity<Record<string, never>> {}

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          // External methods with names of internal method
          const createTestClass = methods.registerEntity(
            'TestClass',
            TestClass,
            (stateBuilder: StateBuilder) => () =>
              new TestClass(stateBuilder.build({}))
          );
          assert.throws(() =>
            methods.registerEntity(
              'TestClass',
              TestClass2,
              (stateBuilder: StateBuilder) => () =>
                new TestClass2(stateBuilder.build({}))
            )
          );

          const { promise, resolve } = Promise.withResolvers<TestClass>();
          const testClassHolder = methods.create(
            'holder',
            (testClass: TestClass) => {
              resolve(testClass);
            }
          );

          const futures = methods.build();

          return {
            futures,
            futureDatabase,
            createTestClass,
            testClassHolder,
            promise,
          };
        }

        let futureId: FutureId<void>;

        {
          const { futures, futureDatabase, createTestClass, testClassHolder } =
            await createMethods();
          const testClassInstance = createTestClass();
          assert.ok(testClassInstance instanceof TestClass);

          const { future, id } = futures.withResolvers<void>();
          futureId = id;

          future.next(testClassHolder.bindArgs(testClassInstance));

          await dbHolder.close(futureDatabase);
        }

        {
          const { futures, futureDatabase, promise } = await createMethods();
          futures.resolveFutureById(futureId);

          const testClassInstance = await promise;

          assert.ok(testClassInstance instanceof TestClass);

          await dbHolder.close(futureDatabase);
        }
      });
      test("can't create an Entity with the same name as a Method", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        class TestClass extends Entity<Record<string, never>> {}

        // External methods with names of internal method
        methods.create('method', () => {});
        assert.throws(() =>
          methods.registerEntity(
            'method',
            TestClass,
            (stateBuilder: StateBuilder) => () =>
              new TestClass(stateBuilder.build({}))
          )
        );
        await dbHolder.close(futureDatabase);
      });
    });

    describe('build', () => {
      describe('before build', () => {
        test('can call createMethod', async (t) => {
          const dbHolder = await testSettings.createDbHolder();
          dbHolder.addCleanup(t);
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          methods.create('method', () => {});
          await dbHolder.close(futureDatabase);
        });

        test('can call build', async (t) => {
          const dbHolder = await testSettings.createDbHolder();
          dbHolder.addCleanup(t);
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          methods.build();
          await dbHolder.close(futureDatabase);
        });
      });
      describe('after build', () => {
        test("can't call createMethod", async (t) => {
          const dbHolder = await testSettings.createDbHolder();
          dbHolder.addCleanup(t);
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          methods.build();
          assert.throws(() => methods.create('method', () => {}));
          await dbHolder.close(futureDatabase);
        });

        test("can't call build", async (t) => {
          const dbHolder = await testSettings.createDbHolder();
          dbHolder.addCleanup(t);
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          methods.build();
          assert.throws(() => methods.build());
          await dbHolder.close(futureDatabase);
        });
      });
    });
  });

  describe('FutureMachine', () => {
    describe('general', () => {
      test('can be bound to Methods across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<FuturesAPI>();
          const method = methods.create('method', (futures: FuturesAPI) => {
            resolve(futures);
          });

          const futures = methods.build();

          return { futureDatabase, method, futures, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futures } = await createMethods();
          const { future, id } = futures.withResolvers<void>();
          futureId = id;

          future.next(method.bindArgs(futures));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futures, promise } = await createMethods();
          futures.resolveFutureById(futureId);

          // TODO: Should we figure out how to make it strictEqual. Likely would
          // need be able to get Structs and other containers by ids.
          assert.deepStrictEqual(await promise, futures);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can call createFuture', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);
        const futures = methods.build();
        futures.create(() => {});
        await dbHolder.close(futureDatabase);
      });

      test('can call createFutureWithResolvers', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);
        const futures = methods.build();
        futures.withResolvers();
        await dbHolder.close(futureDatabase);
      });

      test('can call resolveFutureById', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);
        const futures = methods.build();
        futures.resolveFutureById('' as FutureId<Serializable>);
        await dbHolder.close(futureDatabase);
      });
      test('can call rejectFutureById', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);
        const futures = methods.build();
        futures.rejectFutureById('' as FutureId<Serializable>);
        await dbHolder.close(futureDatabase);
      });

      test('can call resolve', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);
        const futures = methods.build();
        futures.resolve(undefined);
        await dbHolder.close(futureDatabase);
      });

      test('can call reject', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);
        const futures = methods.build();
        futures.reject(undefined);
        await dbHolder.close(futureDatabase);
      });

      test('can call try', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);
        const method = methods.create('method', () => {});
        const futures = methods.build();
        futures.try(method);
        await dbHolder.close(futureDatabase);
      });
    });

    describe('race', () => {
      test('the Future returned by FutureMachine.race is resolved by the first future that resolves', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f1, resolve: r1 } = futures.withResolvers<string>();
        const { future: f2, resolve: r2 } = futures.withResolvers<number>();

        const raceFuture = futures.race([f1, f2]);

        const result = 4312;

        r2(result);
        r1('Hello');

        assert.strictEqual(await raceFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('the Future returned by FutureMachine.race is resolved with an already resolved Future if only unsettled Futures proceed it', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const result = 4312;
        const { future: f1, resolve: r1 } = futures.withResolvers<string>();
        const f2 = futures.resolve<number>(result);

        const raceFuture = futures.race([f1, f2, true]);

        r1('Hello');

        assert.strictEqual(await raceFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('the Future returned by FutureMachine.race is resolved with a non-Future if only unsettled Futures proceed it', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const result = 4312;
        const { future: f1, resolve: r1 } = futures.withResolvers<string>();
        const f2 = futures.resolve<boolean>(true);

        const raceFuture = futures.race([f1, result, f2]);

        r1('Hello');

        assert.strictEqual(await raceFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('the Future returned by FutureMachine.race is rejected by the first future that rejects', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f1, reject: r1 } = futures.withResolvers<string>();
        const { future: f2, reject: r2 } = futures.withResolvers<number>();

        const raceFuture = futures.race([f1, f2]);

        const result = 4312;

        r2(result);
        r1('Hello');

        await assertPromiseRejects(raceFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('the Future returned by FutureMachine.race is rejected with an already resolved Future if only unsettled Futures proceed it', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const result = 4312;
        const { future: f1, resolve: r1 } = futures.withResolvers<string>();
        const f2 = futures.reject<number>(result);

        const raceFuture = futures.race([f1, f2, Promise.resolve(true)]);

        r1('Hello');

        await assertPromiseRejects(raceFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('FutureMachine.race works with iterables', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f1, resolve: r1 } = futures.withResolvers<number>();
        const { future: f2, resolve: r2 } = futures.withResolvers<number>();

        const iterable = (function* () {
          yield f1;
          yield f2;
        })();

        const raceFuture = futures.race(iterable);

        const result = 4312;

        r2(result);
        r1(9999);

        assert.strictEqual(await raceFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('if the iterable passed to FutureMachine.race throws, then the Future it returns is rejected', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const result = 4312;

        // eslint-disable-next-line require-yield
        const iterable = (function* (): Generator<number> {
          throw result;
        })();

        const raceFuture = futures.race(iterable);

        await assertPromiseRejects(raceFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('if the iterable passed to FutureMachine.race throws a non serializable, then the Future it returns is rejected with a SerializableException', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        // eslint-disable-next-line require-yield
        const iterable = (function* (): Generator<number> {
          throw {};
        })();

        const future = futures.race(iterable);

        const exception = await getPromiseRejectReason(future.getPromise());

        assert.ok(exception instanceof SerializableException);
        assert.doesNotMatch(exception.stack, /race/);
        assert.notStrictEqual(exception.stack, exception.toString());

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('if the iterable passed to FutureMachine.race calls race again with a iterable that throws a non serializable, then the Future it returns is rejected with a SerializableException whose stack include FutureMachine.race', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        let future;

        // eslint-disable-next-line require-yield
        const throwingIterable = (function* (): Generator<number> {
          throw {};
        })();

        // eslint-disable-next-line require-yield
        const iterable = (function* (): Generator<number> {
          future = futures.race(throwingIterable);
        })();

        futures.race(iterable);

        const exception = await getPromiseRejectReason(future!.getPromise());

        assert.ok(exception instanceof SerializableException);
        assert.match(exception.stack, /race/);
        assert.notStrictEqual(exception.stack, exception.toString());

        // TODO: This fails. Not sure if it should or not?
        // assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('FutureMachine.race works across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<string | number>();
          const method = methods.create('method', (result: string | number) => {
            resolve(result);
          });

          return {
            method,
            promise,
            futureDatabase,
            futures: methods.build(),
          };
        }

        let id1: FutureId<number>;
        let id2: FutureId<string>;

        {
          const { method, futureDatabase, futures } = await createMethods();
          const { future: f1, id: id1_ } = futures.withResolvers<number>();
          const { future: f2, id: id2_ } = futures.withResolvers<string>();
          id1 = id1_;
          id2 = id2_;

          const raceFuture = futures.race([f1, f2]);

          raceFuture.next(method);
          await dbHolder.close(futureDatabase);
        }

        {
          const { promise, futureDatabase, futures } = await createMethods();
          const result = 4312;

          futures.resolveFutureById(id1, result);
          futures.resolveFutureById(id2, 'Hello');

          assert.strictEqual(await promise, result);
          assert.ok(await dbHolder.isEmpty(futureDatabase));
          await dbHolder.close(futureDatabase);
        }
      });

      test("a PromiseLike doesn't win the race if unresolved", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { promise: p1, resolve: r1 } = Promise.withResolvers<string>();
        const { future: f2, resolve: r2 } = futures.withResolvers<number>();

        const raceFuture = futures.race([p1, f2]);

        const result = 4312;

        r2(result);
        r1('Hello');

        assert.strictEqual(await raceFuture.getPromise(), result);

        await p1;

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      // The requirement that it's 2 microtasks ahead comes from:
      // - FutureMachine.resolve queueing a microtask to call Promise.then
      // - That Promise needs to queue a microtask to trigger the reaction to
      //   resolve the Future which queues a microtask to trigger its reactions
      test('a PromiseLike wins the race if its the first to resolves two microtasks ahead of any Future resolving', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f2, resolve: r1 } = futures.withResolvers<string>();
        const { promise: p2, resolve: r2 } = Promise.withResolvers<number>();

        const raceFuture = futures.race([p2, f2]);

        const result = 4312;

        r2(result);
        await dbHolder.flush(futureDatabase);
        r1('Hello');

        assert.strictEqual(await raceFuture.getPromise(), result);

        await p2;

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });
    });

    describe('all', () => {
      test('a Future returned from FutureMachine.all is resolved when all its Futures in the iterable are resolved', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f1, resolve: r1 } = futures.withResolvers<string>();
        const { future: f2, resolve: r2 } = futures.withResolvers<string>();

        const test = (function* () {
          yield f1;
          yield f2;
        })();

        const allFuture = futures.all(test);

        const results: [string, string] = ['Hello', 'world!'];

        r2(results[1]);
        r1(results[0]);

        assert.deepStrictEqual([...(await allFuture.getPromise())], results);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('a Future returned from FutureMachine.all is resolved when all its Futures in the array are resolved', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f1, resolve: r1 } = futures.withResolvers<string>();
        const { future: f2, resolve: r2 } = futures.withResolvers<number>();

        const allFuture = futures.all([f1, f2]);

        const results: [string, number] = ['Hello', 1234];

        r2(results[1]);
        r1(results[0]);

        assert.deepStrictEqual([...(await allFuture.getPromise())], results);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('a Future returned from FutureMachine.all is rejected when any of its Futures are rejected', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f1, reject: r1 } = futures.withResolvers<string>();
        const { future: f2, resolve: r2 } = futures.withResolvers<number>();

        const allFuture = futures.all([f1, f2]);

        const result = 1234;

        r2(4321);
        r1(result);

        await assertPromiseRejects(allFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('a Future returned from FutureMachine.all is resolved with the non-Futures', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f2, resolve: r2 } = futures.withResolvers<number>();

        const results: [string, number] = ['Hello', 1234];
        const allFuture = futures.all([results[0], f2]);

        r2(results[1]);

        assert.deepStrictEqual([...(await allFuture.getPromise())], results);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('if the iterable passed to FutureMachine.all throws, then the Future it returns is rejected', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const result = 4312;

        // eslint-disable-next-line require-yield
        const iterable = (function* (): Generator<number> {
          throw result;
        })();

        const allFuture = futures.all(iterable);

        await assertPromiseRejects(allFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('if the iterable passed to FutureMachine.all throws a non serializable, then the Future it returns is rejected with a SerializableException', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        // eslint-disable-next-line require-yield
        const iterable = (function* (): Generator<number> {
          throw {};
        })();

        const future = futures.all(iterable);

        const exception = await getPromiseRejectReason(future.getPromise());

        assert.ok(exception instanceof SerializableException);
        assert.doesNotMatch(exception.stack, /all/);
        assert.notStrictEqual(exception.stack, exception.toString());

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('if the iterable passed to FutureMachine.all calls all again with a iterable that throws a non serializable, then the Future it returns is rejected with a SerializableException whose stack include FutureMachine.all', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        let future;

        // eslint-disable-next-line require-yield
        const throwingIterable = (function* (): Generator<number> {
          throw {};
        })();

        // eslint-disable-next-line require-yield
        const iterable = (function* (): Generator<number> {
          future = futures.all(throwingIterable);
        })();

        futures.all(iterable);

        const exception = await getPromiseRejectReason(future!.getPromise());

        assert.ok(exception instanceof SerializableException);
        assert.match(exception.stack, /all/);
        assert.notStrictEqual(exception.stack, exception.toString());

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('FutureMachine.all works across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<List<[string, number]>>();
          const method = methods.create(
            'method',
            (result: List<[string, number]>) => {
              resolve(result);
            }
          );

          return {
            method,
            promise,
            futureDatabase,
            futures: methods.build(),
          };
        }

        let id1;
        let id2;

        {
          const { method, futureDatabase, futures } = await createMethods();
          const { future: f1, id: id1_ } = futures.withResolvers<string>();
          const { future: f2, id: id2_ } = futures.withResolvers<number>();
          id1 = id1_;
          id2 = id2_;

          const allFuture = futures.all([f1, f2] as const);

          allFuture.next(method);
          await dbHolder.close(futureDatabase);
        }

        const results: [string, number] = ['Hello', 1234];

        {
          const { futureDatabase, futures } = await createMethods();

          futures.resolveFutureById(id2, results[1]);
          await dbHolder.close(futureDatabase);
        }

        {
          const { promise, futureDatabase, futures } = await createMethods();

          futures.resolveFutureById(id1, results[0]);

          assert.deepStrictEqual([...(await promise)], results);
          assert.ok(await dbHolder.isEmpty(futureDatabase));
          await dbHolder.close(futureDatabase);
        }
      });

      test('a Future returned from FutureMachine.all is resolved only when all PromiseLikes are resolved', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { promise, resolve: r1 } = Promise.withResolvers<string>();
        const { future: f2, resolve: r2 } = futures.withResolvers<number>();

        const results: [string, number] = ['Hello', 1234];
        const allFuture = futures.all([promise, f2]);

        r2(results[1]);
        r1(results[0]);

        assert.deepStrictEqual([...(await allFuture.getPromise())], results);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('a Future returned from FutureMachine.all is resolved with undefined if an empty array was passed', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const allFuture = futures.all([]);

        assert.deepStrictEqual([...(await allFuture.getPromise())], []);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });
    });

    describe('any', () => {
      test('the Future returned by FutureMachine.any is resolved by the first future that resolves', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f1, resolve: r1 } = futures.withResolvers<string>();
        const { future: f2, resolve: r2 } = futures.withResolvers<number>();

        const anyFuture = futures.any([f1, f2]);

        const result = 4312;

        r2(result);
        r1('Hello');

        assert.strictEqual(await anyFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('the Future returned by FutureMachine.any is resolved with an already resolved Future if only unsettled Futures proceed it', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const result = 4312;
        const { future: f1, resolve: r1 } = futures.withResolvers<string>();
        const f2 = futures.resolve<number>(result);

        const anyFuture = futures.any([f1, f2, true]);

        r1('Hello');

        assert.strictEqual(await anyFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('the Future returned by FutureMachine.any is resolved with a non-Future if only unsettled Futures proceed it', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const result = 4312;
        const { future: f1, resolve: r1 } = futures.withResolvers<string>();
        const f2 = futures.resolve<boolean>(true);

        const anyFuture = futures.any([f1, result, f2]);

        r1('Hello');

        assert.strictEqual(await anyFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test("the Future returned by FutureMachine.any isn't rejected if one of its Futures resolves", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f1, reject: r1 } = futures.withResolvers<string>();
        const { future: f2, resolve: r2 } = futures.withResolvers<number>();

        const anyFuture = futures.any([f1, f2]);

        const result = 4312;

        r1('Hello');
        r2(result);

        assert.strictEqual(await anyFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('the Future returned by FutureMachine.any is rejected with an AggregateException if all its Futures reject', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f1, reject: r1 } = futures.withResolvers<string>();
        const { future: f2, reject: r2 } = futures.withResolvers<number>();

        const anyFuture = futures.any([f1, f2]);

        const results = [4312, 'Hello'];

        r2(results[1]);
        r1(results[0]);

        await assertPromiseRejectsWithAggregateException(
          anyFuture.getPromise(),
          results
        );

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('the Future returned by FutureMachine.any is rejected with an AggregateException if all its Futures reject across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<AggregateException>();
          const onException = methods.create(
            'onException',
            (exception: AggregateException) => {
              resolve(exception);
            }
          );

          const futures = methods.build();
          return {
            futureDatabase,
            futures,
            promise,
            onException,
          };
        }

        const results = [4312, 'Hello'];

        let futureId1: FutureId<string>;
        let futureId2: FutureId<number>;

        {
          const { futureDatabase, futures, onException } =
            await createMethods();
          const { future: f1, id: id1 } = futures.withResolvers<string>();
          const { future: f2, id: id2 } = futures.withResolvers<number>();
          futureId1 = id1;
          futureId2 = id2;

          const anyFuture = futures.any([f1, f2]);
          anyFuture.catch(onException);

          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futures } = await createMethods();

          futures.rejectFutureById(futureId2, results[1]);

          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futures, promise } = await createMethods();

          futures.rejectFutureById(futureId1, results[0]);

          assertIsAggregateException(await promise, results);

          assert.ok(await dbHolder.isEmpty(futureDatabase));
          await dbHolder.close(futureDatabase);
        }
      });

      test('an AggregateException can be bound to a Method across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<AggregateException>();
          const onException = methods.create(
            'onException',
            (exception: AggregateException) => {
              resolve(exception);
            }
          );

          const futures = methods.build();
          return { futureDatabase, futures, promise, onException };
        }

        const results = [4312, 'Hello'];

        let futureId: FutureId<void>;

        {
          const { futureDatabase, futures, onException, promise } =
            await createMethods();
          const { future: f1, reject: r1 } = futures.withResolvers<string>();
          const { future: f2, reject: r2 } = futures.withResolvers<number>();

          const anyFuture = futures.any([f1, f2]);
          anyFuture.catch(onException);

          r2(results[1]);
          r1(results[0]);

          const { future: f3, id: id3 } = futures.withResolvers<void>();
          futureId = id3;

          f3.next(onException.bindArgs(await promise));

          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futures, promise } = await createMethods();

          futures.resolveFutureById(futureId);

          assertIsAggregateException(await promise, results);

          assert.ok(await dbHolder.isEmpty(futureDatabase));
          await dbHolder.close(futureDatabase);
        }
      });

      test('FutureMachine.any works with iterables', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f1, resolve: r1 } = futures.withResolvers<number>();
        const { future: f2, resolve: r2 } = futures.withResolvers<number>();

        const iterable = (function* () {
          yield f1;
          yield f2;
        })();

        const anyFuture = futures.any(iterable);

        const result = 4312;

        r2(result);
        r1(9999);

        assert.strictEqual(await anyFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('if the iterable passed to FutureMachine.any throws, then the Future it returns is rejected', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const result = 4312;

        // eslint-disable-next-line require-yield
        const iterable = (function* (): Generator<number> {
          throw result;
        })();

        const anyFuture = futures.any(iterable);

        await assertPromiseRejects(anyFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('if the iterable passed to FutureMachine.any throws a non serializable, then the Future it returns is rejected with a SerializableException', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        // eslint-disable-next-line require-yield
        const iterable = (function* (): Generator<number> {
          throw {};
        })();

        const future = futures.any(iterable);

        const exception = await getPromiseRejectReason(future.getPromise());

        assert.ok(exception instanceof SerializableException);
        assert.doesNotMatch(exception.stack, /any/);
        assert.notStrictEqual(exception.stack, exception.toString());

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('if the iterable passed to FutureMachine.any calls any again with a iterable that throws a non serializable, then the Future it returns is rejected with a SerializableException whose stack include FutureMachine.any', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        let future;

        // eslint-disable-next-line require-yield
        const throwingIterable = (function* (): Generator<number> {
          throw {};
        })();

        // eslint-disable-next-line require-yield
        const iterable = (function* (): Generator<number> {
          future = futures.any(throwingIterable);
        })();

        futures.any(iterable);

        const exception = await getPromiseRejectReason(future!.getPromise());

        assert.ok(exception instanceof SerializableException);
        assert.match(exception.stack, /any/);
        assert.notStrictEqual(exception.stack, exception.toString());

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('FutureMachine.any works across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<string | number>();
          const method = methods.create('method', (result: string | number) => {
            resolve(result);
          });

          return {
            method,
            promise,
            futureDatabase,
            futures: methods.build(),
          };
        }

        let id1: FutureId<number>;
        let id2: FutureId<string>;

        {
          const { method, futureDatabase, futures } = await createMethods();
          const { future: f1, id: id1_ } = futures.withResolvers<number>();
          const { future: f2, id: id2_ } = futures.withResolvers<string>();
          id1 = id1_;
          id2 = id2_;

          const anyFuture = futures.any([f1, f2]);

          anyFuture.next(method);
          await dbHolder.close(futureDatabase);
        }

        {
          const { promise, futureDatabase, futures } = await createMethods();
          const result = 4312;

          futures.resolveFutureById(id1, result);
          futures.resolveFutureById(id2, 'Hello');

          assert.strictEqual(await promise, result);
          assert.ok(await dbHolder.isEmpty(futureDatabase));
          await dbHolder.close(futureDatabase);
        }
      });

      test("a PromiseLike doesn't win the any if unresolved", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { promise: p1, resolve: r1 } = Promise.withResolvers<string>();
        const { future: f2, resolve: r2 } = futures.withResolvers<number>();

        const anyFuture = futures.any([p1, f2]);

        const result = 4312;

        r2(result);
        r1('Hello');

        assert.strictEqual(await anyFuture.getPromise(), result);

        await p1;

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      // The requirement that it's 2 microtasks ahead comes from:
      // - FutureMachine.resolve queueing a microtask to call Promise.then
      // - That Promise needs to queue a microtask to trigger the reaction to
      //   resolve the Future which queues a microtask to trigger its reactions
      test('a PromiseLike wins the any if its the first to resolves two microtasks ahead of any Future resolving', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f2, resolve: r1 } = futures.withResolvers<string>();
        const { promise: p2, resolve: r2 } = Promise.withResolvers<number>();

        const anyFuture = futures.any([p2, f2]);

        const result = 4312;

        r2(result);
        await Promise.resolve();
        await Promise.resolve();
        r1('Hello');

        assert.strictEqual(await anyFuture.getPromise(), result);

        await p2;

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('a Future returned from FutureMachine.any is rejected with an AggregateException when an empty array is passed', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const anyFuture = futures.any([]);

        await assertPromiseRejectsWithAggregateException(
          anyFuture.getPromise(),
          []
        );

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('a Future returned from FutureMachine.any is rejected with an AggregateException when iterator is complete', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const iterable = (function* (): Generator<number> {
          yield 1;
          yield 2;
          yield 3;
        })();
        iterable.return(undefined);

        const anyFuture = futures.any(iterable);

        await assertPromiseRejectsWithAggregateException(
          anyFuture.getPromise(),
          []
        );

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });
    });

    describe('allSettled', () => {
      test('a Future returned from FutureMachine.allSettled is resolved when all its Futures in the iterable are resolved', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f1, resolve: r1 } = futures.withResolvers<string>();
        const { future: f2, reject: r2 } = futures.withResolvers<string>();

        const test = (function* () {
          yield f1;
          yield f2;
        })();

        const allSettledFuture = futures.allSettled(test);

        const results: AnyFutureSettledResult<string>[] = [
          { status: 'fulfilled', value: 'Hello' },
          { status: 'rejected', reason: 1234 },
        ];

        r2(results[1]!.reason);
        r1(results[0]!.value!);

        assertFutureSettledResultListEquals(
          await allSettledFuture.getPromise(),
          results
        );

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('a Future returned from FutureMachine.allSettled is resolved when all its Futures in the array are resolved', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f1, resolve: r1 } = futures.withResolvers<string>();
        const { future: f2, reject: r2 } = futures.withResolvers<number>();

        const allSettledFuture = futures.allSettled([f1, f2]);

        const results: AnyFutureSettledResult<string>[] = [
          { status: 'fulfilled', value: 'Hello' },
          { status: 'rejected', reason: 1234 },
        ];

        r2(results[1]!.reason);
        r1(results[0]!.value!);

        assertFutureSettledResultListEquals(
          await allSettledFuture.getPromise(),
          results
        );

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('a Future returned from FutureMachine.allSettled is resolved with the non-Futures', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { future: f2, reject: r2 } = futures.withResolvers<number>();

        const results: AnyFutureSettledResult<string>[] = [
          { status: 'fulfilled', value: 'Hello' },
          { status: 'rejected', reason: 1234 },
        ];
        const allSettledFuture = futures.allSettled([results[0]!.value, f2]);

        r2(results[1]!.reason);

        assertFutureSettledResultListEquals(
          await allSettledFuture.getPromise(),
          results
        );

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('if the iterable passed to FutureMachine.allSettled throws, then the Future it returns is rejected', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const result = 4312;

        // eslint-disable-next-line require-yield
        const iterable = (function* (): Generator<number> {
          throw result;
        })();

        const allSettledFuture = futures.allSettled(iterable);

        await assertPromiseRejects(allSettledFuture.getPromise(), result);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('if the iterable passed to FutureMachine.allSettled throws a non serializable, then the Future it returns is rejected with a SerializableException', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        // eslint-disable-next-line require-yield
        const iterable = (function* (): Generator<number> {
          throw {};
        })();

        const future = futures.allSettled(iterable);

        const exception = await getPromiseRejectReason(future.getPromise());

        assert.ok(exception instanceof SerializableException);
        assert.doesNotMatch(exception.stack, /allSettled/);
        assert.notStrictEqual(exception.stack, exception.toString());

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('if the iterable passed to FutureMachine.allSettled calls allSettled again with a iterable that throws a non serializable, then the Future it returns is rejected with a SerializableException whose stack include FutureMachine.allSettled', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        let future;

        // eslint-disable-next-line require-yield
        const throwingIterable = (function* (): Generator<number> {
          throw {};
        })();

        // eslint-disable-next-line require-yield
        const iterable = (function* (): Generator<number> {
          future = futures.allSettled(throwingIterable);
        })();

        futures.allSettled(iterable);

        const exception = await getPromiseRejectReason(future!.getPromise());

        assert.ok(exception instanceof SerializableException);
        assert.match(exception.stack, /allSettled/);
        assert.notStrictEqual(exception.stack, exception.toString());

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('FutureMachine.allSettled works across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<List<FutureSettledResult<string>[]>>();
          const method = methods.create(
            'method',
            (result: List<FutureSettledResult<string>[]>) => {
              resolve(result);
            }
          );

          return {
            method,
            promise,
            futureDatabase,
            futures: methods.build(),
          };
        }

        let id1;
        let id2;

        {
          const { futureDatabase, method, futures } = await createMethods();
          const { future: f1, id: id1_ } = futures.withResolvers<string>();
          const { future: f2, id: id2_ } = futures.withResolvers<string>();
          id1 = id1_;
          id2 = id2_;

          const allSettledFuture = futures.allSettled([f1, f2] as const);

          allSettledFuture.next(method);
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, promise, futures } = await createMethods();

          const results: AnyFutureSettledResult<string>[] = [
            {
              status: 'fulfilled',
              value: 'Hello',
            },
            {
              status: 'rejected',
              reason: 1234,
            },
          ];

          futures.rejectFutureById(id2, results[1]!.reason);
          futures.resolveFutureById(id1, results[0]!.value);

          assertFutureSettledResultListEquals(await promise, results);
          assert.ok(await dbHolder.isEmpty(futureDatabase));
          await dbHolder.close(futureDatabase);
        }
      });

      test('a Future returned from FutureMachine.allSettled is resolved only when all PromiseLikes are resolved', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { promise, resolve: r1 } = Promise.withResolvers<string>();
        const { future: f2, reject: r2 } = futures.withResolvers<number>();

        const results: AnyFutureSettledResult<string>[] = [
          {
            status: 'fulfilled',
            value: 'Hello',
          },
          {
            status: 'rejected',
            reason: '1234',
          },
        ];
        const allSettledFuture = futures.allSettled([promise, f2]);

        r2(results[1]!.reason);
        r1(results[0]!.value!);

        assertFutureSettledResultListEquals(
          await allSettledFuture.getPromise(),
          results
        );

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('a Future returned from FutureMachine.allSettled is resolved only when all PromiseLikes are rejected', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const { promise, reject: r1 } = Promise.withResolvers<string>();
        const { future: f2, reject: r2 } = futures.withResolvers<number>();

        const results: AnyFutureSettledResult<string>[] = [
          {
            status: 'rejected',
            reason: 1234,
          },
          {
            status: 'rejected',
            reason: '1234',
          },
        ];
        const allSettledFuture = futures.allSettled([promise, f2]);

        r2(results[1]!.reason);
        r1(results[0]!.reason);

        assertFutureSettledResultListEquals(
          await allSettledFuture.getPromise(),
          results
        );

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('a Future returned from FutureMachine.allSettled is resolved with undefined if an empty array was passed', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createFutureMachine(futureDatabase);

        const futures = methods.build();

        const allSettledFuture = futures.allSettled([]);

        assert.deepStrictEqual([...(await allSettledFuture.getPromise())], []);

        assert.ok(await dbHolder.isEmpty(futureDatabase));
        await dbHolder.close(futureDatabase);
      });

      test('A List of FutureSettledResults can persist across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const results: AnyFutureSettledResult<string>[] = [
          {
            status: 'fulfilled',
            value: 'Hello',
          },
          {
            status: 'rejected',
            reason: '1234',
          },
        ];

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<List<FutureSettledResult<string>[]>>();
          const method = methods.create(
            'method',
            (result: List<FutureSettledResult<string>[]>) => {
              resolve(result);
            }
          );

          return {
            method,
            promise,
            futureDatabase,
            futures: methods.build(),
          };
        }

        let holderFutureId;

        {
          const { futureDatabase, method, futures, promise } =
            await createMethods();
          const { future: f1, resolve: r1 } = futures.withResolvers<string>();
          const { future: f2, reject: r2 } = futures.withResolvers<string>();

          const allSettledFuture = futures.allSettled([f1, f2] as const);

          r2(results[1]!.reason);
          r1(results[0]!.value!);

          allSettledFuture.next(method);

          const { future: f3, id: id3 } = futures.withResolvers<void>();
          holderFutureId = id3;

          f3.next(method.bindArgs(await promise));

          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, promise, futures } = await createMethods();

          futures.resolveFutureById(holderFutureId, undefined);

          assertFutureSettledResultListEquals(await promise, results);
          assert.ok(await dbHolder.isEmpty(futureDatabase));
          await dbHolder.close(futureDatabase);
        }
      });

      test('A FutureSettledResult can persist across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const result: AnyFutureSettledResult<string> = {
          status: 'fulfilled',
          value: 'Hello',
        };

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createFutureMachine(futureDatabase);

          const { promise: getterPromise, resolve: getterResolve } =
            Promise.withResolvers<FutureSettledResult<string>>();
          const getter = methods.create(
            'getter',
            (result: List<[FutureSettledResult<string>]>) => {
              getterResolve(result.at(0));
            }
          );

          const { promise: holderPromise, resolve: holderResolve } =
            Promise.withResolvers<FutureSettledResult<string>>();
          const holder = methods.create(
            'holder',
            (result: FutureSettledResult<string>) => {
              holderResolve(result);
            }
          );

          return {
            getter,
            getterPromise,
            holder,
            holderPromise,
            futureDatabase,
            futures: methods.build(),
          };
        }

        let holderFutureId;

        {
          const { futureDatabase, getter, getterPromise, holder, futures } =
            await createMethods();
          const { future: f1, resolve: r1 } = futures.withResolvers<string>();

          const allSettledFuture = futures.allSettled([f1] as const);

          r1(result.value!);

          allSettledFuture.next(getter);

          const { future: f3, id: id3 } = futures.withResolvers<void>();
          holderFutureId = id3;

          f3.next(holder.bindArgs(await getterPromise));

          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, holderPromise, futures } =
            await createMethods();

          futures.resolveFutureById(holderFutureId, undefined);

          assertFutureSettledResultEquals(await holderPromise, result);
          assert.ok(await dbHolder.isEmpty(futureDatabase));
          await dbHolder.close(futureDatabase);
        }
      });

      test('can have containers as entries', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        type structType = {
          A: boolean | undefined;
          B: number;
        };

        type stateType = {
          [entityKey1]: number | undefined;
          [entityKey2]: number;
        };

        type resultsType = List<
          [
            FutureSettledResult<Dictionary<number>>,
            FutureSettledResult<List<string[]>>,
            FutureSettledResult<Struct<structType>>,
            FutureSettledResult<TestClass>,
          ]
        >;

        const dictKey = 'World';
        const dictValue = 1234;

        const listItem0 = 'hello';
        const listItem1 = 'world';

        const structValue1 = true;
        const structValue2 = 123;

        const entityKey1 = 'Hello';
        const entityValue1 = 1234;

        const entityKey2 = 'World';
        const entityValue2 = 4321;

        class TestClass extends Entity<stateType> {
          get [entityKey1]() {
            return this.get(entityKey1);
          }
          set [entityKey1](value: number | undefined) {
            this.set(entityKey1, value);
          }
          get [entityKey2]() {
            return this.get(entityKey2);
          }
        }

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createFutureMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<resultsType>();
          const method = methods.create('method', (dictionary: resultsType) => {
            resolve(dictionary);
          });

          const createTest = methods.registerEntity(
            'test',
            TestClass,
            (stateBuilder: StateBuilder) => () => {
              return new TestClass(
                stateBuilder.build({
                  [entityKey1]: undefined,
                  [entityKey2]: entityValue2,
                })
              );
            }
          );

          const futures = methods.build();

          return {
            containers,
            futureDatabase,
            futures,
            method,
            createTest,
            promise,
          };
        }

        let futureId: FutureId<string>;

        {
          const {
            containers,
            futureDatabase,
            futures,
            method,
            promise,
            createTest,
          } = await createMethods();
          const { future, id } = futures.withResolvers<string>();
          futureId = id;

          const { future: dictionaryFuture, resolve: dictionaryResolve } =
            futures.withResolvers<Dictionary<number>>();
          const { future: listFuture, resolve: listResolve } =
            futures.withResolvers<List<string[]>>();
          const { future: structFuture, resolve: structResolve } =
            futures.withResolvers<Struct<structType>>();
          const { future: testClassFuture, resolve: testClassResolve } =
            futures.withResolvers<TestClass>();

          const allSettledFuture = futures.allSettled([
            dictionaryFuture,
            listFuture,
            structFuture,
            testClassFuture,
          ] as const);

          const dictionaryEntry = containers.dictionary.create<number>();

          const listEntry = containers.list.create<string[]>(
            listItem0,
            listItem1
          );

          const structEntry = containers.struct.create<structType>({
            A: undefined,
            B: structValue2,
          });

          const entityEntry = createTest();

          dictionaryResolve(dictionaryEntry);
          listResolve(listEntry);
          structResolve(structEntry);
          testClassResolve(entityEntry);

          dictionaryEntry.set(dictKey, dictValue);
          structEntry.A = structValue1;
          entityEntry[entityKey1] = entityValue1;

          allSettledFuture.next(method);

          future.next(method.bindArgs(await promise));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futures, promise } = await createMethods();
          futures.resolveFutureById(futureId, dictKey);

          const results: resultsType = await promise;

          const dictionaryEntry = (
            results.at(0) as FutureFulfilledResult<Dictionary<number>>
          ).value!;
          assert.strictEqual(dictionaryEntry.get(dictKey), dictValue);

          const listEntry = (
            results.at(1) as FutureFulfilledResult<List<string[]>>
          ).value!;
          assert.notStrictEqual(listEntry, undefined);
          assert.strictEqual(listEntry.at(0), listItem0);
          assert.strictEqual(listEntry.at(1), listItem1);

          const structEntry = (
            results.at(2) as FutureFulfilledResult<Struct<structType>>
          ).value!;
          assert.notStrictEqual(structEntry, undefined);
          assert.strictEqual(structEntry.A, structValue1);
          assert.strictEqual(structEntry.B, structValue2);

          const entityEntry = (
            results.at(3) as FutureFulfilledResult<TestClass>
          ).value!;
          assert.notStrictEqual(entityEntry, undefined);
          assert.strictEqual(entityEntry[entityKey1], entityValue1);
          assert.strictEqual(entityEntry[entityKey2], entityValue2);

          await dbHolder.close(futureDatabase);
        }
      });
    });
  });
};
