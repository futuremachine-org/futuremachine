import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import type { Serializable } from 'node:child_process';
import type { Dictionary, List } from '../../src/index.js';
import {
  createMethodMachine,
  Exception,
  Future,
  Method,
  SerializableException,
  TypeException,
  type FutureId,
  type FutureMachine,
  type ResolveCallback,
} from '../../src/index.js';
import type { TestSettings } from '../export_tests.js';
import {
  assertPromiseRejects,
  createMethod,
  createMethodWithName,
  getPromiseRejectReason,
} from '../test_helpers.js';

export default (testSettings: TestSettings) => {
  describe('Future', () => {
    describe('resolve', () => {
      test('resolve calls next functions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method: method1, promise: promise1 } = createMethod<
          string,
          number
        >(methods, 1);

        const { method: method2, promise: promise2 } =
          createMethod<number>(methods);
        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<string>();

        future.next(method1).next(method2);

        const resultString = 'Hello';

        futureResolve(resultString);

        assert.strictEqual(await promise1, resultString);

        assert.strictEqual(await promise2, 1);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test("can't resolve a Future with itself", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);
        const { method, promise } = createMethod<TypeException>(methods);

        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<string>();

        future.catch(method);
        futureResolve(future);

        assert.strictEqual((await promise).constructor, TypeException);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('only the first resolve counts', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);
        const { method, promise } = createMethod<number>(methods);
        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<number>();

        future.next(method);

        futureResolve(1);
        futureResolve(2);

        assert.strictEqual(await promise, 1);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('resolve has no effect if reject has already been called', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);
        const { method, promise } = createMethod<number>(methods);
        const futureMachine = methods.build();

        const {
          future,
          resolve: futureResolve,
          reject: futureReject,
        } = futureMachine.withResolvers<number>();

        future.catch(method);
        future.next(method);

        futureReject(1);
        futureResolve(2);

        assert.strictEqual(await promise, 1);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('resolved across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);
          const { method, promise } = createMethodWithName<string>(
            methods,
            'myMethod'
          );
          return {
            futureDatabase,
            futureMachine: methods.build(),
            method,
            promise,
          };
        }

        let futureId: FutureId<string>;

        // Initial session.
        {
          const { futureDatabase, futureMachine, method } =
            await createMethods();

          const { future, id } = futureMachine.withResolvers<string>();

          futureId = id;
          future.next(method);
          await dbHolder.close(futureDatabase);
        }

        // New session.
        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();

          futureMachine.resolveFutureById(futureId, 'hello');

          assert.strictEqual(await promise, 'hello');

          await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test('next unwraps futures', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future: future1, resolve: futureResolve1 } =
          futureMachine.withResolvers<number>();

        future1.next(method);

        const { future: future2, resolve: futureResolve2 } =
          futureMachine.withResolvers<number>();

        futureResolve1(future2);

        const result = 2222;
        futureResolve2(result);
        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('next unwraps futures returned by onFulfilled', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const {
          promise: methodResolverPromise,
          resolve: methodResolverResolve,
        } = Promise.withResolvers<ResolveCallback<number>>();
        const futureReturningMethod = methods.create(
          'Future returning method',
          (futureMachine: FutureMachine) => {
            const { future, resolve } = futureMachine.withResolvers<number>();
            methodResolverResolve(resolve);
            return future;
          }
        );

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future: future1, resolve: futureResolve1 } =
          futureMachine.withResolvers<void>();

        future1
          .next(futureReturningMethod.bindArgs(futureMachine))
          .next(method);

        const result = 2222;
        futureResolve1();
        (await methodResolverPromise)(result);

        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('next works when Future is resolved', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<number>();

        const result = 2222;
        futureResolve(result);

        future.next(method);

        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('can resolve multiple Futures with the same resolved Future', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method: method1, promise: promise1 } =
          createMethod<number>(methods);
        const { method: method2, promise: promise2 } =
          createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future: futureResult, resolve: futureResolveResult } =
          futureMachine.withResolvers<number>();

        const { future: futureOther1, resolve: futureResolveOther1 } =
          futureMachine.withResolvers<number>();

        const { future: futureOther2, resolve: futureResolveOther2 } =
          futureMachine.withResolvers<number>();

        const result = 2222;
        futureResolveResult(result);

        futureResolveOther1(futureResult);
        futureResolveOther2(futureResult);

        futureOther1.next(method1);
        futureOther2.next(method2);

        assert.strictEqual(await promise1, result);
        assert.strictEqual(await promise2, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('can resolve a Future with a unresolved Future', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future: future1, resolve: futureResolve1 } =
          futureMachine.withResolvers<number>();

        const { future: future2, resolve: futureResolve2 } =
          futureMachine.withResolvers<number>();

        futureResolve2(future1);

        future2.next(method);

        const result = 2222;
        futureResolve1(result);

        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('can resolve a Future with a resolved Future', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future: future1, resolve: futureResolve1 } =
          futureMachine.withResolvers<number>();

        const { future: future2, resolve: futureResolve2 } =
          futureMachine.withResolvers<number>();

        const result = 2222;
        futureResolve1(result);

        futureResolve2(future1);

        future2.next(method);

        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('the fulfill reactions of a Future remain after that Future is used for the result of another Future', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method: method1, promise: promise1 } =
          createMethod<number>(methods);
        const { method: method2, promise: promise2 } =
          createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future: future1, resolve: futureResolve1 } =
          futureMachine.withResolvers<number>();

        future1.next(method1);

        const { future: future2, resolve: futureResolve2 } =
          futureMachine.withResolvers<number>();

        future2.next(method2);

        futureResolve2(future1);

        const result = 2222;
        futureResolve1(result);

        assert.strictEqual(await promise1, result);
        assert.strictEqual(await promise2, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('next works with an already resolved Future returned by another next call', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method: method1, promise: promise1 } = createMethod<
          string,
          number
        >(methods, 1);

        const { method: method2, promise: promise2 } =
          createMethod<number>(methods);
        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<string>();

        const future2 = future.next(method1);

        const resultString = 'Hello';

        futureResolve(resultString);

        // `futureResolve` will have queued a microtask to call `method1` with
        // `resultString` and use the return value to resolve `future2`.
        await dbHolder.flush(futureDatabase);
        future2.next(method2);

        assert.strictEqual(await promise1, resultString);

        assert.strictEqual(await promise2, 1);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test("next works on an already resolved Future that's resolved with a falsy value", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<number | undefined>(methods);

        const futureMachine = methods.build();

        const { future, resolve: futureResolve } = futureMachine.withResolvers<
          number | undefined
        >();

        const result = undefined;
        futureResolve(result);

        future.next(method);

        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test("when an onFulfilled throws an exception, it's associated Future is rejected", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, exceptions } = createMethodMachine(futureDatabase);

        const specialNum = 3;

        const throwMethod = methods.create(
          'throw',
          (exception: Exception, arg: number) => {
            if (arg === specialNum) {
              throw exception;
            }
          }
        );

        const { method: catchMethod, promise: catchPromise } =
          createMethod<Exception>(methods);

        const futureMachine = methods.build();
        const exception = exceptions.createException('Three not allowed');

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<number>();

        future.next(throwMethod.bindArgs(exception)).catch(catchMethod);

        futureResolve(specialNum);

        assert.deepStrictEqual(await catchPromise, exception);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test("for an already resolved Future, when an onFulfilled throws an exception, it's associated Future is rejected", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, exceptions } = createMethodMachine(futureDatabase);

        const specialNum = 3;

        const throwMethod = methods.create(
          'throw',
          (exception: Exception, arg: number) => {
            if (arg === specialNum) {
              throw exception;
            }
          }
        );

        const { method: catchMethod, promise: catchPromise } =
          createMethod<Exception>(methods);

        const futureMachine = methods.build();
        const exception = exceptions.createException('Three not allowed');

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<number>();

        futureResolve(specialNum);

        future.next(throwMethod.bindArgs(exception)).catch(catchMethod);

        assert.deepStrictEqual(await catchPromise, exception);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('next forwards result if no onFulfilled is provided', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<string>(methods);

        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<string>();

        future.next().next(method);

        const resultString = 'Hello';

        futureResolve(resultString);

        assert.strictEqual(await promise, resultString);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('for an already resolved Future, next forwards result if no onFulfilled is provided', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<string>(methods);

        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<string>();

        const resultString = 'Hello';

        futureResolve(resultString);

        future.next().next(method);

        assert.strictEqual(await promise, resultString);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('next forwards the result of resolving with a resolved Future', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<string>(methods);

        const futureMachine = methods.build();

        const { future: future1, resolve: futureResolve1 } =
          futureMachine.withResolvers<string>();

        const { future: future2, resolve: futureResolve2 } =
          futureMachine.withResolvers<string>();

        const resultString = 'Hello';

        futureResolve1(resultString);
        futureResolve2(future1);

        future2.next(method);

        assert.strictEqual(await promise, resultString);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('next works with a Future returned from FutureMachine.resolve', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const result = 2222;

        futureMachine.resolve(result).next(method);

        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('FutureMachine.resolve has an optional result when the type is void', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        assert.strictEqual(
          await futureMachine.resolve<void>().getPromise(),
          undefined
        );

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('next works with a Future returned from FutureMachine.resolve when resolved with a Future', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future: resultFuture, resolve: futureResolve } =
          futureMachine.withResolvers<number>();

        const result = 2222;
        futureMachine.resolve(resultFuture).next(method);
        futureResolve(result);

        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('next works with a Future returned from FutureMachine.resolve when resolved with a Promise', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const { promise: resultPromise, resolve: resultResolve } =
          Promise.withResolvers<number>();

        const result = 2222;
        futureMachine.resolve(resultPromise).next(method);
        resultResolve(result);

        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('FutureMachine.try returns a resolved Future when the Method succeeds', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const tryMethod = methods.create('tryMethod', (value: number) => {
          return value;
        });

        const { method: resultMethod, promise: resultPromise } =
          createMethod<number>(methods);

        const futureMachine = methods.build();

        const result = 2222;
        futureMachine.try(tryMethod, result).next(resultMethod);

        assert.strictEqual(await resultPromise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('FutureMachine.try returns a resolved Future when the Method succeeds (with multiple args)', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const tryMethod = methods.create(
          'tryMethod',
          (value: number, otherValue: string): List<[number, string]> => {
            return containers.createList(value, otherValue);
          }
        );

        const { method: resultMethod, promise: resultPromise } =
          createMethod<List<[number, string]>>(methods);

        const futureMachine = methods.build();

        const result1 = 2222;
        const result2 = 'Hello';
        futureMachine.try(tryMethod, result1, result2).next(resultMethod);

        assert.deepStrictEqual([...(await resultPromise)], [result1, result2]);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test("when a future resolves, futures that are returned from it's catch method are resolved as well", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const method = methods.create(
          'method',
          (msg: string, value: string) => {
            results.push(`${msg}: ${value}`);
            return value;
          }
        );

        const { method: resultMethod, promise: resultPromise } =
          createMethod<string>(methods);

        const futureMachine = methods.build();
        const results: List<string[]> = containers.createList<string[]>();

        const { future: f1, resolve: r1 } =
          futureMachine.withResolvers<string>();
        f1.next(method.bindArgs('f1.next'));
        const f2 = f1.catch(method.bindArgs('f1.catch'));
        f2.next(method.bindArgs('f2.next'), method.bindArgs('f2.catch')).next(
          resultMethod
        );
        r1('Hello');

        assert.strictEqual(await resultPromise, 'Hello');

        assert.deepStrictEqual(
          [...results],
          ['f1.next: Hello', 'f2.next: Hello']
        );

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('next unwraps Promises returned by onFulfilled', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const {
          promise: methodResolverPromise,
          resolve: methodResolverResolve,
        } =
          Promise.withResolvers<
            (value: number | PromiseLike<number>) => void
          >();
        const futureReturningMethod = methods.create(
          'Future returning method',
          () => {
            const { promise, resolve } = Promise.withResolvers<number>();
            methodResolverResolve(resolve);
            return promise;
          }
        );

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future: future1, resolve: futureResolve1 } =
          futureMachine.withResolvers<void>();

        future1.next(futureReturningMethod).next(method);

        const result = 2222;
        futureResolve1();
        (await methodResolverPromise)(result);

        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('next unwraps a Future in a Promise returned by onFulfilled', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const {
          promise: methodResolverPromise,
          resolve: methodResolverResolve,
        } =
          Promise.withResolvers<
            (value: Future<number> | PromiseLike<Future<number>>) => void
          >();
        const futureReturningMethod = methods.create(
          'Future returning method',
          () => {
            const { promise, resolve } =
              Promise.withResolvers<Future<number>>();
            methodResolverResolve(resolve);
            return promise;
          }
        );

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future: future1, resolve: futureResolve1 } =
          futureMachine.withResolvers<void>();
        const { future: future2, resolve: futureResolve2 } =
          futureMachine.withResolvers<number>();

        future1.next(futureReturningMethod).next(method);

        const result = 2222;
        futureResolve1();
        (await methodResolverPromise)(future2);
        futureResolve2(result);

        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('onFinally is called when Future resolves', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method: afterFinally, promise: afterFinallyPromise } =
          createMethod<number>(methods);

        const { promise: onFinallyPromise, resolve: onFinallyResolve } =
          Promise.withResolvers<Serializable[]>();
        const onFinally = methods.create(
          'onFinally',
          (...args: Serializable[]) => {
            onFinallyResolve(args);
          }
        );

        const futureMachine = methods.build();

        const { future: resultFuture, resolve: futureResolve } =
          futureMachine.withResolvers<number>();

        const result = 2222;
        resultFuture.finally(onFinally).next(afterFinally);
        futureResolve(result);

        assert.deepStrictEqual(await onFinallyPromise, []);
        assert.strictEqual(await afterFinallyPromise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('onFinally is called when Future resolves across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { method: afterFinally, promise: afterFinallyPromise } =
            createMethodWithName<number>(methods, 'method');

          const { promise: onFinallyPromise, resolve: onFinallyResolve } =
            Promise.withResolvers<Serializable[]>();
          const onFinally = methods.create(
            'onFinally',
            (...args: Serializable[]) => {
              onFinallyResolve(args);
            }
          );

          return {
            futureDatabase,
            futureMachine: methods.build(),
            afterFinally,
            afterFinallyPromise,
            onFinallyPromise,
            onFinally,
          };
        }

        let futureId;
        {
          const { futureDatabase, futureMachine, afterFinally, onFinally } =
            await createMethods();

          const { future: resultFuture, id } =
            futureMachine.withResolvers<number>();
          futureId = id;

          resultFuture.finally(onFinally).next(afterFinally);
          await dbHolder.close(futureDatabase);
        }
        {
          const {
            futureDatabase,
            futureMachine,
            afterFinallyPromise,
            onFinallyPromise,
          } = await createMethods();

          const result = 2222;
          futureMachine.resolveFutureById(futureId, result);

          assert.deepStrictEqual(await onFinallyPromise, []);
          assert.strictEqual(await afterFinallyPromise, result);

          await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test("if onFinally returns a Future, it's resolved before the Future returned by finally resolves", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise: afterFinallyPromise, resolve: afterFinallyResolve } =
          Promise.withResolvers<void>();
        const afterFinally = methods.create('afterFinally', (value: number) => {
          results.push(`afterFinally: ${value}`);
          afterFinallyResolve();
        });

        const { promise: onFinallyPromise, resolve: onFinallyResolve } =
          Promise.withResolvers<ResolveCallback<string>>();
        const onFinally = methods.create(
          'onFinally',
          (futureMachine: FutureMachine) => {
            results.push('onFinally');
            const { future: innerFuture, resolve: innerResolve } =
              futureMachine.withResolvers<string>();
            onFinallyResolve(innerResolve);
            return innerFuture;
          }
        );

        const futureMachine = methods.build();
        const results: List<string[]> = containers.createList<string[]>();

        const { future: resultFuture, resolve: futureResolve } =
          futureMachine.withResolvers<number>();

        const result = 2222;
        resultFuture
          .finally(onFinally.bindArgs(futureMachine))
          .next(afterFinally);
        futureResolve(result);

        const innerResolve = await onFinallyPromise;
        innerResolve('Hello world.');

        assert.deepStrictEqual([...results], ['onFinally']);

        await afterFinallyPromise;
        assert.deepStrictEqual(
          [...results],
          ['onFinally', `afterFinally: ${result}`]
        );

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test("if onFinally returns a Promise, it's resolved before the Future returned by finally resolves", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise: afterFinallyPromise, resolve: afterFinallyResolve } =
          Promise.withResolvers<void>();
        const afterFinally = methods.create(
          'afterFinally',
          (results: List<string[]>, value: number) => {
            results.push(`afterFinally: ${value}`);
            afterFinallyResolve();
          }
        );

        const { promise: onFinallyPromise, resolve: onFinallyResolve } =
          Promise.withResolvers<
            (value: string | PromiseLike<string>) => void
          >();
        const onFinally = methods.create(
          'onFinally',
          (results: List<string[]>) => {
            results.push('onFinally');
            const { promise: innerPromise, resolve: innerResolve } =
              Promise.withResolvers<string>();
            onFinallyResolve(innerResolve);
            return innerPromise;
          }
        );

        const futureMachine = methods.build();
        const results: List<string[]> = containers.createList<string[]>();

        const { future: resultFuture, resolve: futureResolve } =
          futureMachine.withResolvers<number>();

        const result = 2222;
        resultFuture
          .finally(onFinally.bindArgs(results))
          .next(afterFinally.bindArgs(results));
        futureResolve(result);

        const innerResolve = await onFinallyPromise;
        innerResolve('Hello world.');

        assert.deepStrictEqual([...results], ['onFinally']);

        await afterFinallyPromise;
        assert.deepStrictEqual(
          [...results],
          ['onFinally', `afterFinally: ${result}`]
        );

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('when no onFinally is provided and when a Future resolves, the Futures returned by its finally are also resolved', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method: afterFinally, promise: afterFinallyPromise } =
          createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future: resultFuture, resolve: futureResolve } =
          futureMachine.withResolvers<number>();

        const result = 2222;
        resultFuture.finally().next(afterFinally);
        futureResolve(result);

        assert.strictEqual(await afterFinallyPromise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('the promise returned by getPromise is resolved when the future is', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<string>();

        const promise = future.getPromise();

        const resultString = 'Hello';

        futureResolve(resultString);

        assert.strictEqual(await promise, resultString);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('the promise returned by getPromise is already resolved if the future is', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<string>();

        const resultString = 'Hello';

        futureResolve(resultString);

        const promise = future.getPromise();

        assert.strictEqual(await promise, resultString);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('the promise returned by getPromise is resolved when any Future representing the same future is resolved', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const futureCount = 4;

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, exceptions } = createMethodMachine(futureDatabase);

          const promiseWithResolvers = new Array(futureCount)
            .fill(undefined)
            .map(() => Promise.withResolvers<Future<string>>());
          let resolveCount = 0;

          const futureHolderMethod = methods.create(
            'futureHolderMethod',
            (
              exceededFutureCountException: Exception,
              future: Future<string>
            ) => {
              const resolve = promiseWithResolvers[resolveCount]?.resolve;
              if (!resolve) {
                throw exceededFutureCountException;
              }
              resolve(future);
              resolveCount++;
            }
          );

          const futureMachine = methods.build();
          const exceededFutureCountException = exceptions.createException(
            `Resolved more than the futureCount of ${futureCount}`
          );
          return {
            exceptions,
            futureDatabase,
            futureHolderMethod: futureHolderMethod.bindArgs(
              exceededFutureCountException
            ),
            futureMachine,
            promises: promiseWithResolvers.map(({ promise }) => promise),
          };
        }

        let heldFutureId: FutureId<string>;
        const futureIdHolders: FutureId<void>[] = [];

        const resultString = 'Hello';

        {
          const { futureDatabase, futureHolderMethod, futureMachine } =
            await createMethods();
          const { future: heldFuture, id: heldId } =
            futureMachine.withResolvers<string>();
          heldFutureId = heldId;

          for (let i = 0; i < futureCount; i++) {
            const { future, id } = futureMachine.withResolvers<void>();
            futureIdHolders.push(id);
            future.next(futureHolderMethod.bindArgs(heldFuture));
          }

          await dbHolder.close(futureDatabase);
        }

        {
          const { exceptions, futureDatabase, futureMachine, promises } =
            await createMethods();

          let futureIndex = 0;
          function getNextFutureHolder() {
            const futureId = futureIdHolders.at(futureIndex);
            if (futureId === undefined) {
              throw exceptions.createException(
                `Exceeded the number of future ids ${futureCount}`
              );
            }
            futureMachine.resolveFutureById(futureId);
            const promise = promises.at(futureIndex);

            if (promise === undefined) {
              throw exceptions.createException(
                `There was a futureHolder at ${futureCount} but not a promise`
              );
            }
            futureIndex++;
            return promise;
          }

          const futureHolder1 = await getNextFutureHolder();
          const futureHolder2 = await getNextFutureHolder();

          futureMachine.resolveFutureById(heldFutureId, resultString);

          assert.strictEqual(await futureHolder1.getPromise(), resultString);
          assert.strictEqual(await futureHolder2.getPromise(), resultString);

          const futureHolder3 = await getNextFutureHolder();

          assert.strictEqual(await futureHolder3.getPromise(), resultString);

          const futureHolder4 = await getNextFutureHolder();

          assert.strictEqual(await futureHolder4.getPromise(), resultString);

          // TODO: This check fails.
          //
          // await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test('getPromise always returns the same promise', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<string>();

        const resultString = 'Hello';

        futureResolve(resultString);

        const promise1 = future.getPromise();
        const promise2 = future.getPromise();

        assert.strictEqual(promise1, promise2);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('a Future cannot be resolved multiple times', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future, resolve } = futureMachine.withResolvers<number>();

        const result = 4312;
        resolve(result);
        resolve(123);

        assert.strictEqual(await future.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('a Future cannot be resolved multiple times across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<number>();
          const method = methods.create('method', (value: number) => {
            resolve(value);
          });

          const futureMachine = methods.build();

          return { futureDatabase, futureMachine, method, promise };
        }

        let futureId: FutureId<number>;
        const result = 4312;

        {
          const { futureDatabase, futureMachine, method } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<number>();
          futureId = id;
          future.next(method);
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId, result);
          futureMachine.resolveFutureById(futureId, 123);

          assert.strictEqual(await promise, result);
          await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test('a Future cannot be rejected after being resolved', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future, resolve, reject } =
          futureMachine.withResolvers<number>();

        const result = 4312;
        resolve(result);
        reject(123);

        assert.strictEqual(await future.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('a Future cannot be rejected after being resolved across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<number>();
          const method = methods.create('method', (value: number) => {
            resolve(value);
          });

          const futureMachine = methods.build();

          return { futureDatabase, futureMachine, method, promise };
        }

        let futureId: FutureId<number>;
        const result = 4312;

        {
          const { futureDatabase, futureMachine, method } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<number>();
          futureId = id;
          future.next(method);
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId, result);
          futureMachine.rejectFutureById(futureId, 123);

          assert.strictEqual(await promise, result);
          await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test('a Future that is resolved with a Future cannot be resolved while the latter Future is unsettled', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future: f1, resolve: r1 } =
          futureMachine.withResolvers<number>();
        const { future: f2, resolve: r2 } =
          futureMachine.withResolvers<number>();

        r1(f2);
        r1(123);

        const result = 4312;
        r2(result);

        assert.strictEqual(await f1.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('a Future that is resolved with a Future cannot be resolved while the latter Future is unsettled across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<number>();
          const method = methods.create('method', (value: number) => {
            resolve(value);
          });

          const futureMachine = methods.build();

          return { futureDatabase, futureMachine, method, promise };
        }

        let futureId1: FutureId<number>;
        let futureId2: FutureId<number>;

        {
          const { futureDatabase, futureMachine, method } =
            await createMethods();
          const {
            future: f1,
            resolve: r1,
            id: id1,
          } = futureMachine.withResolvers<number>();
          const { future: f2, id: id2 } = futureMachine.withResolvers<number>();
          futureId1 = id1;
          futureId2 = id2;

          f1.next(method);
          r1(f2);

          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine } = await createMethods();

          futureMachine.resolveFutureById(futureId1, 123);
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          const result = 4312;
          futureMachine.resolveFutureById(futureId2, result);

          assert.strictEqual(await promise, result);
          await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test('a Future that is resolved with a Promise cannot be resolved while the Promise is unsettled', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future: f, resolve: rf } =
          futureMachine.withResolvers<number>();
        const { promise: p, resolve: rp } = Promise.withResolvers<number>();

        rf(p);
        rf(123);

        const result = 4312;
        rp(result);

        assert.strictEqual(await f.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('a Future that is resolved with a Future cannot be rejected while the latter Future is unsettled', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const {
          future: f1,
          resolve: r1,
          reject,
        } = futureMachine.withResolvers<number>();
        const { future: f2, resolve: r2 } =
          futureMachine.withResolvers<number>();

        r1(f2);
        reject(123);

        const result = 4312;
        r2(result);

        assert.strictEqual(await f1.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('a Future that is resolved with a Future cannot be rejected while the latter Future is unsettled across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<number>();
          const method = methods.create('method', (value: number) => {
            resolve(value);
          });

          const futureMachine = methods.build();

          return { futureDatabase, futureMachine, method, promise };
        }

        let futureId1: FutureId<number>;
        let futureId2: FutureId<number>;

        {
          const { futureDatabase, futureMachine, method } =
            await createMethods();
          const {
            future: f1,
            resolve: r1,
            id: id1,
          } = futureMachine.withResolvers<number>();
          const { future: f2, id: id2 } = futureMachine.withResolvers<number>();
          futureId1 = id1;
          futureId2 = id2;

          f1.next(method);
          r1(f2);

          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine } = await createMethods();

          futureMachine.rejectFutureById(futureId1, 123);
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          const result = 4312;
          futureMachine.resolveFutureById(futureId2, result);

          assert.strictEqual(await promise, result);
          await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test('a Future that is resolved with a Promise cannot be rejected while the Promise is unsettled', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const {
          future: f,
          resolve: rf,
          reject,
        } = futureMachine.withResolvers<number>();
        const { promise: p, resolve: rp } = Promise.withResolvers<number>();

        rf(p);
        reject(123);

        const result = 4312;
        rp(result);

        assert.strictEqual(await f.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('the resolve function can be passed to next', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future: f1, resolve: r1 } =
          futureMachine.withResolvers<string>();
        const { future: f2, resolve: r2 } =
          futureMachine.withResolvers<string>();

        f1.next(r2);

        const result = 'Hello';
        r1(result);

        assert.strictEqual(await f2.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('the resolve function can be passed to catch', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future: f1, reject: r1 } =
          futureMachine.withResolvers<string>();
        const { future: f2, resolve: r2 } =
          futureMachine.withResolvers<string>();

        f1.catch(r2);

        const result = 'Hello';
        r1(result);

        assert.strictEqual(await f2.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      // TODO: This threw a SerializableException?
      test('if resolve is called before the executor throws, then the Future is resolved', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future: f1, resolve: r1 } =
          futureMachine.withResolvers<number>();
        const f2 = futureMachine.create(
          (_id: FutureId<number>, r2: ResolveCallback<number>) => {
            r2(f1);
            throw 'error';
          }
        );
        const result = 1234;
        r1(result);

        assert.strictEqual(await f2.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test("can't resolve a Future with itself after its already been resolved by another Future", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future: f1, resolve: r1 } =
          futureMachine.withResolvers<number>();
        const { future: f2, resolve: r2 } =
          futureMachine.withResolvers<number>();

        r1(f2);
        r1(f1);
        const result = 1234;
        r2(result);

        assert.strictEqual(await f1.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('can resolve a Future with another Future across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<number>();
          const method = methods.create('method', (value: number) => {
            resolve(value);
          });

          const futureMachine = methods.build();

          return { futureDatabase, futureMachine, method, promise };
        }

        let futureId: FutureId<number>;
        const result = 4312;

        {
          const { futureDatabase, futureMachine, method } =
            await createMethods();
          const { future: f1, id } = futureMachine.withResolvers<number>();
          const { future: f2, resolve } = futureMachine.withResolvers<number>();
          futureId = id;
          f2.next(method);
          resolve(f1);
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId, result);

          assert.strictEqual(await promise, result);
          await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test("can resolve a Future with another Future across sessions and that Future can't be resolved again", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<number>();
          const method = methods.create('method', (value: number) => {
            resolve(value);
          });

          const { promise: holderPromise, resolve: holderResolve } =
            Promise.withResolvers<ResolveCallback<number>>();
          const resolverHolder = methods.create(
            'futureHolder',
            (value: ResolveCallback<number>) => {
              holderResolve(value);
            }
          );

          const futureMachine = methods.build();

          return {
            futureDatabase,
            futureMachine,
            method,
            promise,
            resolverHolder,
            holderPromise,
          };
        }

        let resultFutureId: FutureId<number>;
        let holderFutureId: FutureId<void>;
        const result = 4312;

        {
          const { futureDatabase, futureMachine, method, resolverHolder } =
            await createMethods();
          const { future: heldFuture, resolve } =
            futureMachine.withResolvers<number>();
          const { future: holdingFuture, id: holdingId } =
            futureMachine.withResolvers<void>();

          holderFutureId = holdingId;

          heldFuture.next(method);
          holdingFuture.next(resolverHolder.bindArgs(resolve));
          await dbHolder.close(futureDatabase);
        }

        {
          const {
            futureDatabase,
            futureMachine,
            resolverHolder,
            holderPromise,
          } = await createMethods();
          const { future: resultFuture, id: resultId } =
            futureMachine.withResolvers<number>();
          const { future: holdingFuture, id: holdingId } =
            futureMachine.withResolvers<void>();

          futureMachine.resolveFutureById(holderFutureId);
          const resolveHeldFuture = await holderPromise;

          holderFutureId = holdingId;

          resultFutureId = resultId;
          resolveHeldFuture(resultFuture);
          holdingFuture.next(resolverHolder.bindArgs(resolveHeldFuture));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise, holderPromise } =
            await createMethods();
          futureMachine.resolveFutureById(holderFutureId);
          const resolveHeldFuture = await holderPromise;

          resolveHeldFuture(9898);

          futureMachine.resolveFutureById(resultFutureId, result);

          assert.strictEqual(await promise, result);
          await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test('the same instance of a Future created by create is always returned for the same session until garbage collection', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { promise, resolve: rP } =
          Promise.withResolvers<Future<number>>();
        const holder = methods.create('holder', (future: Future<number>) => {
          rP(future);
        });

        const futureMachine = methods.build();

        const { future: holdingFuture, id } =
          futureMachine.withResolvers<void>();

        const future = futureMachine.create<number>(() => {});

        holdingFuture.next(holder.bindArgs(future));

        futureMachine.resolveFutureById(id);
        const heldFuture = await promise;

        assert.strictEqual(heldFuture, future);

        await dbHolder.close(futureDatabase);
      });

      test('the same instance of a Future created by withResolvers is always returned for the same session until garbage collection', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { promise, resolve: rP } =
          Promise.withResolvers<Future<number>>();
        const holder = methods.create('holder', (future: Future<number>) => {
          rP(future);
        });

        const futureMachine = methods.build();

        const { future: holdingFuture, id } =
          futureMachine.withResolvers<void>();

        const { future } = futureMachine.withResolvers<number>();

        holdingFuture.next(holder.bindArgs(future));

        futureMachine.resolveFutureById(id);
        const heldFuture = await promise;

        assert.strictEqual(heldFuture, future);

        await dbHolder.close(futureDatabase);
      });

      test('the same instance of a Future created by next is always returned for the same session until garbage collection', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { promise, resolve: rP } =
          Promise.withResolvers<Future<number>>();
        const holder = methods.create('holder', (future: Future<number>) => {
          rP(future);
        });

        const futureMachine = methods.build();

        const { future: holdingFuture, id } =
          futureMachine.withResolvers<void>();

        const { future: firstFuture } = futureMachine.withResolvers<number>();
        const future = firstFuture.next();

        holdingFuture.next(holder.bindArgs(future));

        futureMachine.resolveFutureById(id);
        const heldFuture = await promise;

        assert.strictEqual(heldFuture, future);

        await dbHolder.close(futureDatabase);
      });

      test('the same instance of a Future created by resolve is always returned for the same session until garbage collection', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { promise, resolve: rP } =
          Promise.withResolvers<Future<number>>();
        const holder = methods.create('holder', (future: Future<number>) => {
          rP(future);
        });

        const futureMachine = methods.build();

        const { future: holdingFuture, id } =
          futureMachine.withResolvers<void>();

        const future = futureMachine.resolve<number>(1);

        holdingFuture.next(holder.bindArgs(future));

        futureMachine.resolveFutureById(id);
        const heldFuture = await promise;

        assert.strictEqual(heldFuture, future);

        await dbHolder.close(futureDatabase);
      });
    });

    describe('reject', () => {
      test('reject calls catch functions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method: method1, promise: promise1 } = createMethod<
          string,
          number
        >(methods, 1);

        const { method: method2, promise: promise2 } =
          createMethod<number>(methods);
        const futureMachine = methods.build();

        const { future, reject: futureReject } =
          futureMachine.withResolvers<string>();

        future.catch(method1).next(method2);

        const resultString = 'Hello';

        futureReject(resultString);

        assert.strictEqual(await promise1, resultString);

        assert.strictEqual(await promise2, 1);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('only the first reject counts', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);
        const { method, promise } = createMethod<number>(methods);
        const futureMachine = methods.build();

        const { future, reject: futureReject } =
          futureMachine.withResolvers<number>();

        future.catch(method);

        futureReject(1);
        futureReject(2);

        assert.strictEqual(await promise, 1);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('reject has no effect if resolve has already been called', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);
        const { method, promise } = createMethod<number>(methods);
        const futureMachine = methods.build();

        const {
          future,
          resolve: futureResolve,
          reject: futureReject,
        } = futureMachine.withResolvers<number>();

        future.catch(method);
        future.next(method);

        futureResolve(1);
        futureReject(2);

        assert.strictEqual(await promise, 1);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('rejects with SerializableException if the then callback throws non serializable', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const thrower = methods.create('thrower', () => {
          throw {};
        });

        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<void>();

        const rejectedFuture = future.next(thrower);

        futureResolve();

        const exception = await getPromiseRejectReason(
          rejectedFuture.getPromise()
        );

        assert.ok(exception instanceof SerializableException);
        // TODO: This should be true:
        // assert.strictEqual(exception.stack, exception.toString());

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      // TODO: Make a recursive version of the above test. There's similar tests
      // where we test the callstack when we throw in the thing that catches the
      // error recursively. E.g. the thing is on the callstack twice.

      test('rejects with SerializableException if the then callback throws a function', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const thrower = methods.create('thrower', () => {
          throw () => {};
        });

        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<void>();

        const rejectedFuture = future.next(thrower);

        futureResolve();

        const exception = await getPromiseRejectReason(
          rejectedFuture.getPromise()
        );

        assert.ok(exception instanceof SerializableException);
        // TODO: This should be true:
        // assert.strictEqual(exception.stack, exception.toString());

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('rejects with SerializableException if the then callback throws a symbol', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const thrower = methods.create('thrower', () => {
          throw Symbol();
        });

        const futureMachine = methods.build();

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<void>();

        const rejectedFuture = future.next(thrower);

        futureResolve();

        const exception = await getPromiseRejectReason(
          rejectedFuture.getPromise()
        );

        assert.ok(exception instanceof SerializableException);
        // TODO: This should be true:
        // assert.strictEqual(exception.stack, exception.toString());

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('rejected across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);
          const { method, promise } = createMethodWithName<string>(
            methods,
            'myMethod'
          );
          return {
            futureDatabase,
            futureMachine: methods.build(),
            method,
            promise,
          };
        }

        let futureId: FutureId<string>;

        // Initial session.
        {
          const { futureDatabase, futureMachine, method } =
            await createMethods();

          const { future, id } = futureMachine.withResolvers<string>();

          futureId = id;
          future.catch(method);
          await dbHolder.close(futureDatabase);
        }

        // New session.
        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();

          futureMachine.rejectFutureById(futureId, 'hello');

          assert.strictEqual(await promise, 'hello');

          await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test('catch works when Future is rejected', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future, reject: futureReject } =
          futureMachine.withResolvers<number>();

        const result = 2222;
        futureReject(result);

        future.catch(method);

        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('rejects if executor throws.', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, exceptions } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const exception: Exception =
          exceptions.createException('Executor threw');
        const future = futureMachine.create<string>(() => {
          throw exception;
        });

        future.catch(method);

        assert.deepStrictEqual(await promise, exception);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('rejects with SerializableException if executor throws non serializable', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const future = futureMachine.create<string>(() => {
          throw {};
        });

        const exception = await getPromiseRejectReason(future.getPromise());

        assert.ok(exception instanceof SerializableException);
        assert.doesNotMatch(exception.stack, /create/);
        assert.notStrictEqual(exception.stack, exception.toString());

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('rejects with SerializableException whose callstack includes FutureMachine.create if executor throws non serializable', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        let future;

        futureMachine.create<string>(() => {
          future = futureMachine.create<string>(() => {
            throw {};
          });
        });

        const exception = await getPromiseRejectReason(future!.getPromise());

        assert.ok(exception instanceof SerializableException);
        assert.match(exception.stack, /create/);
        assert.notStrictEqual(exception.stack, exception.toString());

        await dbHolder.close(futureDatabase);
      });

      test('catch works with an already rejected Future returned by another catch call', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method: method1 } = createMethod<string>(methods);
        const { method: method2, promise } = createMethod<string>(methods);

        const futureMachine = methods.build();

        const { future, reject: futureReject } =
          futureMachine.withResolvers<string>();

        const future2 = future.next(method1);

        const resultString = 'Hello';

        futureReject(resultString);

        // `futureResolve` will have queued a microtask to call `method1` with
        // `resultString` and use the return value to resolve `future2`.
        await dbHolder.flush(futureDatabase);
        future2.catch(method2);

        assert.strictEqual(await promise, resultString);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('catch forwards result if no onRejected is provided', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<string>(methods);

        const futureMachine = methods.build();

        const { future, reject: futureReject } =
          futureMachine.withResolvers<string>();

        future.catch().catch(method);

        const resultString = 'Hello';

        futureReject(resultString);

        assert.strictEqual(await promise, resultString);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('for an already rejected Future, catch forwards result if no onRejected is provided', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<string>(methods);

        const futureMachine = methods.build();

        const { future, reject: futureReject } =
          futureMachine.withResolvers<string>();

        const resultString = 'Hello';

        futureReject(resultString);

        future.catch().catch(method);

        assert.strictEqual(await promise, resultString);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('catch forwards the result of resolving with a rejected Future', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<string>(methods);

        const futureMachine = methods.build();

        const { future: future1, reject: futureReject1 } =
          futureMachine.withResolvers<string>();

        const { future: future2, resolve: futureResolve2 } =
          futureMachine.withResolvers<string>();

        const resultString = 'Hello';

        futureReject1(resultString);
        futureResolve2(future1);

        future2.catch(method);

        assert.strictEqual(await promise, resultString);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test("can catch via next's onRejected", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method: catchMethod, promise } = createMethod<string>(methods);

        const futureMachine = methods.build();

        const { future, reject: futureReject } =
          futureMachine.withResolvers<string>();

        future.next(undefined, catchMethod);

        const resultString = 'Hello';

        futureReject(resultString);

        assert.strictEqual(await promise, resultString);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test("when an onRejected throws an exception, it's associated Future is rejected", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, exceptions } = createMethodMachine(futureDatabase);

        const specialNum = 3;

        const throwMethod = methods.create(
          'throw',
          (exception: Exception, arg: number) => {
            if (arg === specialNum) {
              throw exception;
            }
          }
        );

        const { method: catchMethod, promise: catchPromise } =
          createMethod<Exception>(methods);

        const futureMachine = methods.build();
        const exception = exceptions.createException('Three not allowed');

        const { future, reject: futureReject } =
          futureMachine.withResolvers<number>();

        future.catch(throwMethod.bindArgs(exception)).catch(catchMethod);

        futureReject(specialNum);

        assert.deepStrictEqual(await catchPromise, exception);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test("for an already rejected Future, when an onRejected throws an exception, it's associated Future is rejected", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, exceptions } = createMethodMachine(futureDatabase);

        const specialNum = 3;

        const throwMethod = methods.create(
          'throw',
          (exception: Exception, arg: number) => {
            if (arg === specialNum) {
              throw exception;
            }
          }
        );

        const { method: catchMethod, promise: catchPromise } =
          createMethod<Exception>(methods);

        const futureMachine = methods.build();
        const exception = exceptions.createException('Three not allowed');

        const { future, reject: futureReject } =
          futureMachine.withResolvers<number>();

        futureReject(specialNum);

        future.catch(throwMethod.bindArgs(exception)).catch(catchMethod);

        assert.deepStrictEqual(await catchPromise, exception);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('catch works with a Future returned from FutureMachine.reject', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const result = 2222;

        futureMachine.reject(result).catch(method);

        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('finally works with a resolved Future', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);
        const method = methods.create('method', () => {});
        const futureMachine = methods.build();
        const future4 = futureMachine.resolve(true);
        future4.finally(method);
        await dbHolder.close(futureDatabase);
      });

      test('FutureMachine.reject has an optional result when the type is void', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        await assertPromiseRejects(
          futureMachine.reject<void>().getPromise(),
          undefined
        );

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('catch unwraps futures returned by onRejected', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const {
          promise: methodResolverPromise,
          resolve: methodResolverResolve,
        } = Promise.withResolvers<ResolveCallback<number>>();
        const futureReturningMethod = methods.create(
          'Future returning method',
          (futureMachine: FutureMachine) => {
            const { future, resolve } = futureMachine.withResolvers<number>();
            methodResolverResolve(resolve);
            return future;
          }
        );

        const { method, promise } = createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future: future1, reject: futureReject1 } =
          futureMachine.withResolvers<void>();

        future1
          .catch(futureReturningMethod.bindArgs(futureMachine))
          .next(method);

        const result = 2222;
        futureReject1();
        (await methodResolverPromise)(result);

        assert.strictEqual(await promise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('FutureMachine.try returns a rejected Future when the Method throws', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const tryMethod = methods.create('tryMethod', (value: number) => {
          if (value > 0) {
            throw value;
          }
          return value;
        });

        const { method: resultMethod, promise: resultPromise } =
          createMethod<number>(methods);

        const futureMachine = methods.build();

        const result = 2222;
        futureMachine.try(tryMethod, result).catch(resultMethod);

        assert.strictEqual(await resultPromise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('FutureMachine.try returns a Future rejected with a SerializableException that includes FutureMachine.try on the callstack when the Method throws a non serializable', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const tryMethod = methods.create('tryMethod', () => {
          throw {};
        });

        const futureMachine = methods.build();

        const future = futureMachine.try(tryMethod);

        const exception = await getPromiseRejectReason(future.getPromise());

        assert.ok(exception instanceof SerializableException);
        // TODO: This fails when running stryker because 'stryker' is in the
        // stack which contains 'try'. We should probably get rid of all of
        // these checks and maybe the tests as well. Instead we should directly
        // test the exception boundary logic with very unique function names.
        //
        // assert.doesNotMatch(exception.stack, /try/);
        assert.notStrictEqual(exception.stack, exception.toString());

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('FutureMachine.try returns a Future rejected with a SerializableException when the Method throws a non serializable', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const throwMethod = methods.create('throwMethod', () => {
          throw {};
        });

        let future;
        const tryMethod = methods.create('tryMethod', () => {
          future = futureMachine.try(throwMethod);
        });

        const futureMachine = methods.build();

        futureMachine.try(tryMethod);

        const exception = await getPromiseRejectReason(future!.getPromise());

        assert.ok(exception instanceof SerializableException);
        assert.match(exception.stack, /try/);
        assert.notStrictEqual(exception.stack, exception.toString());

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('FutureMachine.try returns a rejected Future when the Method throws (multiple arguments)', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const tryMethod = methods.create(
          'tryMethod',
          (value: number, otherValue: string) => {
            if (value > 0) {
              throw value;
            }
            return otherValue;
          }
        );

        const { method: resultMethod, promise: resultPromise } =
          createMethod<number>(methods);

        const futureMachine = methods.build();

        const result = 2222;
        futureMachine.try(tryMethod, result, 'Hello').catch(resultMethod);

        assert.strictEqual(await resultPromise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('Futures are settled in the correct order', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const method = methods.create(
          'method',
          (results: List<string[]>, msg: string, value: string) => {
            results.push(`${msg}: ${value}`);
            return value;
          }
        );

        const { method: resultMethod, promise: resultPromise } =
          createMethod<string>(methods);

        const futureMachine = methods.build();

        const results: List<string[]> = containers.createList<string[]>();

        const { future: f1, reject: e1 } =
          futureMachine.withResolvers<string>();
        const f2 = f1.next(method.bindArgs(results, 'f1.next'));
        f1.catch(method.bindArgs(results, 'f1.catch'));
        f2.next(method.bindArgs(results, 'f2.next'))
          .catch(method.bindArgs(results, 'f3.catch'))
          .next(resultMethod);
        f2.catch(method.bindArgs(results, 'f2.catch'));
        e1('Hello');
        // f1.catch Hello
        // f2.catch Hello
        // f3.catch Hello

        assert.strictEqual(await resultPromise, 'Hello');

        assert.deepStrictEqual(
          [...results],
          ['f1.catch: Hello', 'f2.catch: Hello', 'f3.catch: Hello']
        );

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('onFinally is called when Future rejects', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method: afterFinally, promise: afterFinallyPromise } =
          createMethod<number>(methods);

        const { promise: onFinallyPromise, resolve: onFinallyResolve } =
          Promise.withResolvers<Serializable[]>();
        const onFinally = methods.create(
          'onFinally',
          (...args: Serializable[]) => {
            onFinallyResolve(args);
          }
        );

        const futureMachine = methods.build();

        const { future: resultFuture, reject: futureReject } =
          futureMachine.withResolvers<number>();

        const result = 2222;
        resultFuture.finally(onFinally).catch(afterFinally);
        futureReject(result);

        assert.deepStrictEqual(await onFinallyPromise, []);
        assert.strictEqual(await afterFinallyPromise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('when no onFinally is provided and when a Future rejects, the Futures returned by its finally are also rejects', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { method: afterFinally, promise: afterFinallyPromise } =
          createMethod<number>(methods);

        const futureMachine = methods.build();

        const { future: resultFuture, reject: futureReject } =
          futureMachine.withResolvers<number>();

        const result = 2222;
        resultFuture.finally().catch(afterFinally);
        futureReject(result);

        assert.strictEqual(await afterFinallyPromise, result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('the promise returned by getPromise is rejected when the future is', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future, reject: futureRejected } =
          futureMachine.withResolvers<string>();

        const promise = future.getPromise();

        const resultString = 'Hello';

        futureRejected(resultString);

        await assertPromiseRejects(promise, resultString);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('the promise returned by getPromise is already rejected if the future is', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future, reject: futureRejected } =
          futureMachine.withResolvers<string>();

        const resultString = 'Hello';

        futureRejected(resultString);

        const promise = future.getPromise();

        await assertPromiseRejects(promise, resultString);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('if a Future is resolved with a PromiseLike whose getter for then throws, then the Future is rejected', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const errorString = 'Hello';
        const promiseLike: PromiseLike<string> = {
          get then(): (
            onfulfilled?: (value: string) => never,
            onrejected?: (reason: unknown) => never
          ) => PromiseLike<never> {
            throw errorString;
          },
        };

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<string>();

        futureResolve(promiseLike);

        const promise = future.getPromise();

        await assertPromiseRejects(promise, errorString);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('if a Future is resolved with a PromiseLike whose getter for then throws a non serializable, then the Future is rejected with a SerializableException', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const promiseLike: PromiseLike<string> = {
          get then(): (
            onfulfilled?: (value: string) => never,
            onrejected?: (reason: unknown) => never
          ) => PromiseLike<never> {
            throw {};
          },
        };

        const { future, resolve: futureResolve } =
          futureMachine.withResolvers<string>();

        futureResolve(promiseLike);

        const exception = await getPromiseRejectReason(future.getPromise());

        // TODO: What should the stack look like here?
        assert.ok(exception instanceof SerializableException);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test("if a reaction refers to a Method that no longer exists, the reaction's Future is rejected", async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        let futureId: FutureId<string>;

        // Initial session.
        {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);
          const method = methods.create('My Method', () => {});
          const catcher = methods.create('catcher', () => {});
          const futureMachine = methods.build();

          const { future, id } = futureMachine.withResolvers<string>();

          futureId = id;
          future.next(method).catch(catcher);
          await dbHolder.close(futureDatabase);
        }

        // New session.
        {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);
          const { promise: catcherPromise } = createMethodWithName<Exception>(
            methods,
            'catcher'
          );
          const futureMachine = methods.build();

          futureMachine.resolveFutureById(futureId, 'hello');

          assert.ok((await catcherPromise) instanceof Exception);

          await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test('if a bound Method refers to a Method that no longer exists, the Method rejects when called', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        let futureId: FutureId<void>;

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);
          const { promise, resolve } = Promise.withResolvers<Exception>();
          return {
            futureDatabase,
            methods,
            caller: methods.create('caller', (method: Method<() => void>) => {
              method();
            }),
            catcher: methods.create('catcher', (e: Exception) => {
              resolve(e);
            }),
            catcherPromise: promise,
          };
        }

        // Initial session.
        {
          const { futureDatabase, methods, caller, catcher } =
            await createMethods();
          const boundMethod = methods.create('Bound Method', () => {});
          const futureMachine = methods.build();

          const { future, id } = futureMachine.withResolvers<void>();

          futureId = id;
          future.next(caller.bindArgs(boundMethod)).catch(catcher);
          await dbHolder.close(futureDatabase);
        }

        // New session.
        {
          const { futureDatabase, methods, catcherPromise } =
            await createMethods();
          const futureMachine = methods.build();

          futureMachine.resolveFutureById(futureId);

          assert.ok((await catcherPromise) instanceof Exception);

          await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test('a Future cannot be rejected multiple times', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future, reject } = futureMachine.withResolvers<number>();

        const result = 4312;
        reject(result);
        reject(123);

        await assertPromiseRejects(future.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('a Future cannot be rejected multiple times across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<number>();
          const method = methods.create('method', (value: number) => {
            resolve(value);
          });

          const futureMachine = methods.build();

          return { futureDatabase, futureMachine, method, promise };
        }

        let futureId: FutureId<number>;
        const result = 4312;

        {
          const { futureDatabase, futureMachine, method } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<number>();
          futureId = id;
          future.catch(method);
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.rejectFutureById(futureId, result);
          futureMachine.rejectFutureById(futureId, 123);

          assert.strictEqual(await promise, result);
          await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test('a Future cannot be resolved after being rejected', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future, resolve, reject } =
          futureMachine.withResolvers<number>();

        const result = 4312;
        reject(result);
        resolve(123);

        await assertPromiseRejects(future.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('a Future cannot be resolved after being rejected across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<number>();
          const method = methods.create('method', (value: number) => {
            resolve(value);
          });

          const futureMachine = methods.build();

          return { futureDatabase, futureMachine, method, promise };
        }

        let futureId: FutureId<number>;
        const result = 4312;

        {
          const { futureDatabase, futureMachine, method } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<number>();
          futureId = id;
          future.catch(method);
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.rejectFutureById(futureId, result);
          futureMachine.resolveFutureById(futureId, 123);

          assert.strictEqual(await promise, result);
          await dbHolder.assertEmpty(futureDatabase);
          await dbHolder.close(futureDatabase);
        }
      });

      test('the reject function can be passed to next', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future: f1, resolve: r1 } =
          futureMachine.withResolvers<string>();
        const { future: f2, reject: r2 } =
          futureMachine.withResolvers<string>();

        f1.next(r2);

        const result = 'Hello';
        r1(result);

        await assertPromiseRejects(f2.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('the reject function can be passed to catch', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const futureMachine = methods.build();

        const { future: f1, reject: r1 } =
          futureMachine.withResolvers<string>();
        const { future: f2, reject: r2 } =
          futureMachine.withResolvers<string>();

        f1.catch(r2);

        const result = 'Hello';
        r1(result);

        await assertPromiseRejects(f2.getPromise(), result);

        await dbHolder.assertEmpty(futureDatabase);
        await dbHolder.close(futureDatabase);
      });

      test('a rejected Future can be bound to a Method across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<Future<string>>();
          const method = methods.create('method', (future: Future<string>) => {
            resolve(future);
          });

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, promise };
        }

        const rejectValue = 123;

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;
          const boundFuture = futureMachine.reject<string>(rejectValue);

          future.next(method.bindArgs(boundFuture));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          await assertPromiseRejects((await promise).getPromise(), rejectValue);
          await dbHolder.close(futureDatabase);
        }
      });

      test('a rejected Future can hold a container across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Future<Dictionary<number>>>();
          const method = methods.create(
            'method',
            (dictionary: Future<Dictionary<number>>) => {
              resolve(dictionary);
            }
          );
          const thrower = methods.create(
            'thrower',
            (dictionary: Dictionary<number>): Dictionary<number> => {
              throw dictionary;
            }
          );

          const futureMachine = methods.build();

          return {
            containers,
            futureDatabase,
            method,
            thrower,
            futureMachine,
            promise,
          };
        }

        const key = 'Hello';
        const value = 1234;

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, thrower, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const dictionary = containers.createDictionary<number>();
          dictionary.set(key, value);

          const rejectedFuture = futureMachine
            .resolve(dictionary)
            .next(thrower);

          future.next(method.bindArgs(rejectedFuture));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          const dictionary = (await getPromiseRejectReason(
            (await promise).getPromise()
          )) as Dictionary<number>;

          assert.strictEqual(dictionary.get(key), value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('a Future returned by FutureMachine.reject can hold a container across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Future<Dictionary<number>>>();
          const method = methods.create(
            'method',
            (dictionary: Future<Dictionary<number>>) => {
              resolve(dictionary);
            }
          );

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        const key = 'Hello';
        const value = 1234;

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const dictionary = containers.createDictionary();
          dictionary.set(key, value);

          const rejectedFuture =
            futureMachine.reject<Dictionary<number>>(dictionary);

          future.next(method.bindArgs(rejectedFuture));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          const dictionary = (await getPromiseRejectReason(
            (await promise).getPromise()
          )) as Dictionary<number>;

          assert.strictEqual(dictionary.get(key), value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('a rejected Future returned by FutureMachine.try can hold a container across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Future<Dictionary<number>>>();
          const method = methods.create(
            'method',
            (dictionary: Future<Dictionary<number>>) => {
              resolve(dictionary);
            }
          );
          const thrower = methods.create(
            'thrower',
            (dictionary: Dictionary<number>): Dictionary<number> => {
              throw dictionary;
            }
          );

          const futureMachine = methods.build();

          return {
            containers,
            futureDatabase,
            method,
            thrower,
            futureMachine,
            promise,
          };
        }

        const key = 'Hello';
        const value = 1234;

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, thrower, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const dictionary = containers.createDictionary<number>();
          dictionary.set(key, value);

          const rejectedFuture = futureMachine.try(thrower, dictionary);

          future.next(method.bindArgs(rejectedFuture));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          const dictionary = (await getPromiseRejectReason(
            (await promise).getPromise()
          )) as Dictionary<number>;

          assert.strictEqual(dictionary.get(key), value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('a rejected Future can hold a FutureMachine across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Future<FutureMachine>>();
          const method = methods.create(
            'method',
            (future: Future<FutureMachine>) => {
              resolve(future);
            }
          );
          const thrower = methods.create(
            'thrower',
            (futureMachine: FutureMachine): FutureMachine => {
              throw futureMachine;
            }
          );

          const futureMachine = methods.build();

          return { futureDatabase, method, thrower, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, thrower, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const rejectedFuture = futureMachine
            .resolve(futureMachine)
            .next(thrower);

          future.next(method.bindArgs(rejectedFuture));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.deepStrictEqual(
            await getPromiseRejectReason((await promise).getPromise()),
            futureMachine
          );
          await dbHolder.close(futureDatabase);
        }
      });

      test('a rejected Future can hold a Future across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<Future<number>>();
          const method = methods.create('method', (future: Future<number>) => {
            resolve(future);
          });

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        const value = 1;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const rejectedFuture = futureMachine.reject<number>(
            futureMachine.resolve(value)
          );

          future.next(method.bindArgs(rejectedFuture));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          const future = (await getPromiseRejectReason(
            (await promise).getPromise()
          )) as Future<number>;

          assert.ok(future instanceof Future);

          assert.strictEqual(await future.getPromise(), value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('a rejected Future can hold a Future across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<Future<number>>();
          const method = methods.create('method', (future: Future<number>) => {
            resolve(future);
          });
          const thunk = methods.create('thunk', (value: number) => {
            return value;
          });

          const futureMachine = methods.build();

          return { futureDatabase, method, thunk, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        const value = 1;

        {
          const { futureDatabase, method, thunk, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const rejectedFuture = futureMachine.reject<number>(
            thunk.bindArgs(value)
          );

          future.next(method.bindArgs(rejectedFuture));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          const method = (await getPromiseRejectReason(
            (await promise).getPromise()
          )) as Method<() => number>;

          assert.ok(method instanceof Method);

          assert.strictEqual(method(), value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('the same instance of a Future created by reject is always returned for the same session until garbage collection', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { promise, resolve: rP } =
          Promise.withResolvers<Future<number>>();
        const holder = methods.create('holder', (future: Future<number>) => {
          rP(future);
        });

        const futureMachine = methods.build();

        const { future: holdingFuture, id } =
          futureMachine.withResolvers<void>();

        const future = futureMachine.reject<number>('');

        holdingFuture.next(holder.bindArgs(future));

        futureMachine.resolveFutureById(id);
        const heldFuture = await promise;

        assert.strictEqual(heldFuture, future);

        await dbHolder.close(futureDatabase);
      });
    });
  });
};
