import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { assert_equal } from '../../src/asserts.js';
import type { Dictionary } from '../../src/containers/dictionary.js';
import { Entity } from '../../src/containers/entity.js';
import type { StateBuilder } from '../../src/containers/entity_impl.js';
import type { FutureSettledResult } from '../../src/containers/future_settled_result.js';
import type { List } from '../../src/containers/list.js';
import type { Struct } from '../../src/containers/struct.js';
import { Future, type FutureId } from '../../src/core/future.js';
import { createMethodMachine } from '../../src/core/future_machine.js';
import { type TestSettings } from '../export_tests.js';

export default (testSettings: TestSettings) => {
  describe('primitives', () => {
    describe('undefined', () => {
      test('can be bound to Methods across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<undefined>();
          const method = methods.create('method', (value: undefined) => {
            resolve(value);
          });

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          future.next(method.bind(undefined));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual(await promise, undefined);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a Dictionary across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const key = 'Hello';

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Dictionary<undefined>>();
          const method = methods.create(
            'method',
            (dictionary: Dictionary<undefined>) => {
              resolve(dictionary);
            }
          );

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const dictionary = containers.createDictionary<undefined>();
          dictionary.set(key, undefined);

          future.next(method.bind(dictionary));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).get(key), undefined);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a Struct across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        type structType = {
          Hello: undefined;
        };

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Struct<structType>>();
          const method = methods.create(
            'method',
            (struct: Struct<structType>) => {
              resolve(struct);
            }
          );

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const struct = containers.createStruct<structType>({
            Hello: undefined,
          });

          future.next(method.bind(struct));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).Hello, undefined);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a List across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<List<undefined[]>>();
          const method = methods.create('method', (list: List<undefined[]>) => {
            resolve(list);
          });

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const list = containers.createList<undefined[]>();
          list.push(undefined);

          future.next(method.bind(list));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).at(0)!, undefined);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in an Entity across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const key1 = 'Hello';

        type stateType = {
          [key1]: undefined;
        };

        class TestClass extends Entity<stateType> {
          get [key1]() {
            return this.get(key1);
          }
        }

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<TestClass>();
          const method = methods.create('method', (instance: TestClass) => {
            resolve(instance);
          });

          const createTest = methods.registerEntity(
            'test',
            TestClass,
            (stateBuilder: StateBuilder) => () => {
              const state = stateBuilder.build({
                [key1]: undefined,
              });
              return new TestClass(state);
            }
          );

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, createTest, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, createTest, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const instance = createTest();
          future.next(method.bind(instance));

          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          const instance = await promise;

          assert.strictEqual(instance[key1], undefined);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be held in a Future returned by FutureMachine.resolve across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Future<undefined>>();
          const method = methods.create(
            'method',
            (dictionary: Future<undefined>) => {
              resolve(dictionary);
            }
          );

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          future.next(method.bind(futureMachine.resolve(undefined)));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);
          const future: Future<undefined> = await promise;

          assert.strictEqual(await future.getPromise(), undefined);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be thrown across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<unknown>();
          const resolver = methods.create(
            'resolver',
            (list: List<FutureSettledResult<number | void>[]>) => {
              const value = list.at(0);
              assert_equal(
                value.status,
                'rejected',
                'Should have been rejected.'
              );
              resolve(value.reason);
            }
          );
          const thrower = methods.create('thrower', (): number => {
            throw undefined;
          });

          const futureMachine = methods.build();

          return {
            containers,
            futureDatabase,
            resolver,
            thrower,
            futureMachine,
            promise,
          };
        }

        let futureId: FutureId<void>;

        {
          const {
            containers,
            futureDatabase,
            resolver,
            thrower,
            futureMachine,
          } = await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          // TODO: It would be nice if we didn't have to create the list to use
          // allSettled. I think it would be fine for it to take an array or
          // List.
          futureMachine
            .allSettled(
              containers.createList(futureMachine.try(thrower), future)
            )
            .next(resolver);
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual(await promise, undefined);
          await dbHolder.close(futureDatabase);
        }
      });
    });

    describe('null', () => {
      test('can be bound to Methods across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<null>();
          const method = methods.create('method', (value: null) => {
            resolve(value);
          });

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          future.next(method.bind(null));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual(await promise, null);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a Dictionary across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const key = 'Hello';

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Dictionary<null>>();
          const method = methods.create(
            'method',
            (dictionary: Dictionary<null>) => {
              resolve(dictionary);
            }
          );

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const dictionary = containers.createDictionary<null>();
          dictionary.set(key, null);

          future.next(method.bind(dictionary));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).get(key), null);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a Struct across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        type structType = {
          Hello: null;
        };

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Struct<structType>>();
          const method = methods.create(
            'method',
            (struct: Struct<structType>) => {
              resolve(struct);
            }
          );

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const struct = containers.createStruct<structType>({
            Hello: null,
          });

          future.next(method.bind(struct));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).Hello, null);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a List across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<List<null[]>>();
          const method = methods.create('method', (list: List<null[]>) => {
            resolve(list);
          });

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const list = containers.createList<null[]>();
          list.push(null);

          future.next(method.bind(list));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).at(0)!, null);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in an Entity across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const key1 = 'Hello';

        type stateType = {
          [key1]: null;
        };

        class TestClass extends Entity<stateType> {
          get [key1]() {
            return this.get(key1);
          }
        }

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<TestClass>();
          const method = methods.create('method', (instance: TestClass) => {
            resolve(instance);
          });

          const createTest = methods.registerEntity(
            'test',
            TestClass,
            (stateBuilder: StateBuilder) => () => {
              const state = stateBuilder.build({
                [key1]: null,
              });
              return new TestClass(state);
            }
          );

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, createTest, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, createTest, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const instance = createTest();
          future.next(method.bind(instance));

          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          const instance = await promise;

          assert.strictEqual(instance[key1], null);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be held in a Future returned by FutureMachine.resolve across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<Future<null>>();
          const method = methods.create(
            'method',
            (dictionary: Future<null>) => {
              resolve(dictionary);
            }
          );

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          future.next(method.bind(futureMachine.resolve(null)));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);
          const future: Future<null> = await promise;

          assert.strictEqual(await future.getPromise(), null);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be thrown across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<unknown>();
          const resolver = methods.create(
            'resolver',
            (list: List<FutureSettledResult<number | void>[]>) => {
              const value = list.at(0);
              assert_equal(
                value.status,
                'rejected',
                'Should have been rejected.'
              );
              resolve(value.reason);
            }
          );
          const thrower = methods.create('thrower', (): number => {
            throw null;
          });

          const futureMachine = methods.build();

          return {
            containers,
            futureDatabase,
            resolver,
            thrower,
            futureMachine,
            promise,
          };
        }

        let futureId: FutureId<void>;

        {
          const {
            containers,
            futureDatabase,
            resolver,
            thrower,
            futureMachine,
          } = await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          // TODO: It would be nice if we didn't have to create the list to use
          // allSettled. I think it would be fine for it to take an array or
          // List.
          futureMachine
            .allSettled(
              containers.createList(futureMachine.try(thrower), future)
            )
            .next(resolver);
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual(await promise, null);
          await dbHolder.close(futureDatabase);
        }
      });
    });

    describe('boolean', () => {
      test('can be bound to Methods across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<boolean>();
          const method = methods.create('method', (value: boolean) => {
            resolve(value);
          });

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          future.next(method.bind(true));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual(await promise, true);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a Dictionary across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const key = 'Hello';

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Dictionary<boolean>>();
          const method = methods.create(
            'method',
            (dictionary: Dictionary<boolean>) => {
              resolve(dictionary);
            }
          );

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const dictionary = containers.createDictionary<boolean>();
          dictionary.set(key, true);

          future.next(method.bind(dictionary));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).get(key), true);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a Struct across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        type structType = {
          Hello: boolean;
        };

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Struct<structType>>();
          const method = methods.create(
            'method',
            (struct: Struct<structType>) => {
              resolve(struct);
            }
          );

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const struct = containers.createStruct<structType>({
            Hello: true,
          });

          future.next(method.bind(struct));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).Hello, true);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a List across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<List<boolean[]>>();
          const method = methods.create('method', (list: List<boolean[]>) => {
            resolve(list);
          });

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const list = containers.createList<boolean[]>();
          list.push(true);

          future.next(method.bind(list));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).at(0)!, true);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in an Entity across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const key1 = 'Hello';

        type stateType = {
          [key1]: boolean;
        };

        class TestClass extends Entity<stateType> {
          get [key1]() {
            return this.get(key1);
          }
        }

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<TestClass>();
          const method = methods.create('method', (instance: TestClass) => {
            resolve(instance);
          });

          const createTest = methods.registerEntity(
            'test',
            TestClass,
            (stateBuilder: StateBuilder) => () => {
              const state = stateBuilder.build({
                [key1]: true,
              });
              return new TestClass(state);
            }
          );

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, createTest, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, createTest, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const instance = createTest();
          future.next(method.bind(instance));

          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          const instance = await promise;

          assert.strictEqual(instance[key1], true);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be held in a Future returned by FutureMachine.resolve across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<Future<boolean>>();
          const method = methods.create(
            'method',
            (dictionary: Future<boolean>) => {
              resolve(dictionary);
            }
          );

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          future.next(method.bind(futureMachine.resolve(true)));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);
          const future: Future<boolean> = await promise;

          assert.strictEqual(await future.getPromise(), true);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be thrown across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<unknown>();
          const resolver = methods.create(
            'resolver',
            (list: List<FutureSettledResult<number | void>[]>) => {
              const value = list.at(0);
              assert_equal(
                value.status,
                'rejected',
                'Should have been rejected.'
              );
              resolve(value.reason);
            }
          );
          const thrower = methods.create('thrower', (): number => {
            throw false;
          });

          const futureMachine = methods.build();

          return {
            containers,
            futureDatabase,
            resolver,
            thrower,
            futureMachine,
            promise,
          };
        }

        let futureId: FutureId<void>;

        {
          const {
            containers,
            futureDatabase,
            resolver,
            thrower,
            futureMachine,
          } = await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          // TODO: It would be nice if we didn't have to create the list to use
          // allSettled. I think it would be fine for it to take an array or
          // List.
          futureMachine
            .allSettled(
              containers.createList(futureMachine.try(thrower), future)
            )
            .next(resolver);
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual(await promise, false);
          await dbHolder.close(futureDatabase);
        }
      });
    });

    describe('number', () => {
      test('can be bound to Methods across sessions', async (t) => {
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

          return { futureDatabase, method, futureMachine, promise };
        }

        const value = 123;

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          future.next(method.bind(value));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual(await promise, value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a Dictionary across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const key = 'Hello';

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Dictionary<number>>();
          const method = methods.create(
            'method',
            (dictionary: Dictionary<number>) => {
              resolve(dictionary);
            }
          );

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        const value = 123;

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const dictionary = containers.createDictionary<number>();
          dictionary.set(key, value);

          future.next(method.bind(dictionary));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).get(key), value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a Struct across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        type structType = {
          Hello: number;
        };

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Struct<structType>>();
          const method = methods.create(
            'method',
            (struct: Struct<structType>) => {
              resolve(struct);
            }
          );

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        const value = 123;

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const struct = containers.createStruct<structType>({
            Hello: value,
          });

          future.next(method.bind(struct));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).Hello, value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a List across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<List<number[]>>();
          const method = methods.create('method', (list: List<number[]>) => {
            resolve(list);
          });

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        const value = 123;

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const list = containers.createList<number[]>();
          list.push(value);

          future.next(method.bind(list));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).at(0)!, value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in an Entity across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const key1 = 'Hello';
        const value = 123;

        type stateType = {
          [key1]: number;
        };

        class TestClass extends Entity<stateType> {
          get [key1]() {
            return this.get(key1);
          }
        }

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<TestClass>();
          const method = methods.create('method', (instance: TestClass) => {
            resolve(instance);
          });

          const createTest = methods.registerEntity(
            'test',
            TestClass,
            (stateBuilder: StateBuilder) => () => {
              const state = stateBuilder.build({
                [key1]: value,
              });
              return new TestClass(state);
            }
          );

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, createTest, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, createTest, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const instance = createTest();
          future.next(method.bind(instance));

          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          const instance = await promise;

          assert.strictEqual(instance[key1], value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be held in a Future returned by FutureMachine.resolve across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<Future<number>>();
          const method = methods.create(
            'method',
            (dictionary: Future<number>) => {
              resolve(dictionary);
            }
          );

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, promise };
        }

        const value = 123;

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          future.next(method.bind(futureMachine.resolve(value)));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);
          const future: Future<number> = await promise;

          assert.strictEqual(await future.getPromise(), value);
          await dbHolder.close(futureDatabase);
        }
      });
    });

    describe('bigint', () => {
      test('can be bound to Methods across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<bigint>();
          const method = methods.create('method', (value: bigint) => {
            resolve(value);
          });

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, promise };
        }

        const value = 90071992547409919007199254740991n;

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          future.next(method.bind(value));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual(await promise, value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a Dictionary across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const key = 'Hello';

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Dictionary<bigint>>();
          const method = methods.create(
            'method',
            (dictionary: Dictionary<bigint>) => {
              resolve(dictionary);
            }
          );

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        const value = 90071992547409919007199254740991n;

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const dictionary = containers.createDictionary<bigint>();
          dictionary.set(key, value);

          future.next(method.bind(dictionary));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).get(key), value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a Struct across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        type structType = {
          Hello: bigint;
        };

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Struct<structType>>();
          const method = methods.create(
            'method',
            (struct: Struct<structType>) => {
              resolve(struct);
            }
          );

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        const value = 90071992547409919007199254740991n;

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const struct = containers.createStruct<structType>({
            Hello: value,
          });

          future.next(method.bind(struct));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).Hello, value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a List across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<List<bigint[]>>();
          const method = methods.create('method', (list: List<bigint[]>) => {
            resolve(list);
          });

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        const value = 90071992547409919007199254740991n;

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const list = containers.createList<bigint[]>();
          list.push(value);

          future.next(method.bind(list));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).at(0)!, value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in an Entity across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const key1 = 'Hello';
        const value = 90071992547409919007199254740991n;

        type stateType = {
          [key1]: bigint;
        };

        class TestClass extends Entity<stateType> {
          get [key1]() {
            return this.get(key1);
          }
        }

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<TestClass>();
          const method = methods.create('method', (instance: TestClass) => {
            resolve(instance);
          });

          const createTest = methods.registerEntity(
            'test',
            TestClass,
            (stateBuilder: StateBuilder) => () => {
              const state = stateBuilder.build({
                [key1]: value,
              });
              return new TestClass(state);
            }
          );

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, createTest, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, createTest, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const instance = createTest();
          future.next(method.bind(instance));

          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          const instance = await promise;

          assert.strictEqual(instance[key1], value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be held in a Future returned by FutureMachine.resolve across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<Future<bigint>>();
          const method = methods.create(
            'method',
            (dictionary: Future<bigint>) => {
              resolve(dictionary);
            }
          );

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, promise };
        }

        const value = 90071992547409919007199254740991n;

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          future.next(method.bind(futureMachine.resolve(value)));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);
          const future: Future<bigint> = await promise;

          assert.strictEqual(await future.getPromise(), value);
          await dbHolder.close(futureDatabase);
        }
      });
    });

    describe('string', () => {
      test('can be bound to Methods across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<string>();
          const method = methods.create('method', (value: string) => {
            resolve(value);
          });

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, promise };
        }

        const value = 'Hello world!';

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          future.next(method.bind(value));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual(await promise, value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a Dictionary across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const key = 'Hello';

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Dictionary<string>>();
          const method = methods.create(
            'method',
            (dictionary: Dictionary<string>) => {
              resolve(dictionary);
            }
          );

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        const value = 'Hello world!';

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const dictionary = containers.createDictionary<string>();
          dictionary.set(key, value);

          future.next(method.bind(dictionary));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).get(key), value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a Struct across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        type structType = {
          Hello: string;
        };

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } =
            Promise.withResolvers<Struct<structType>>();
          const method = methods.create(
            'method',
            (struct: Struct<structType>) => {
              resolve(struct);
            }
          );

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        const value = 'Hello world!';

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const struct = containers.createStruct<structType>({
            Hello: value,
          });

          future.next(method.bind(struct));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).Hello, value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in a List across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods, containers } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<List<string[]>>();
          const method = methods.create('method', (list: List<string[]>) => {
            resolve(list);
          });

          const futureMachine = methods.build();

          return { containers, futureDatabase, method, futureMachine, promise };
        }

        const value = 'Hello world!';

        let futureId: FutureId<void>;

        {
          const { containers, futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const list = containers.createList<string[]>();
          list.push(value);

          future.next(method.bind(list));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          assert.strictEqual((await promise).at(0)!, value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be in an Entity across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        const key1 = 'Hello';
        const value = 'Hello world!';

        type stateType = {
          [key1]: string;
        };

        class TestClass extends Entity<stateType> {
          get [key1]() {
            return this.get(key1);
          }
        }

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<TestClass>();
          const method = methods.create('method', (instance: TestClass) => {
            resolve(instance);
          });

          const createTest = methods.registerEntity(
            'test',
            TestClass,
            (stateBuilder: StateBuilder) => () => {
              const state = stateBuilder.build({
                [key1]: value,
              });
              return new TestClass(state);
            }
          );

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, createTest, promise };
        }

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, createTest, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          const instance = createTest();
          future.next(method.bind(instance));

          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);

          const instance = await promise;

          assert.strictEqual(instance[key1], value);
          await dbHolder.close(futureDatabase);
        }
      });

      test('can be held in a Future returned by FutureMachine.resolve across sessions', async (t) => {
        const dbHolder = await testSettings.createDbHolder();
        dbHolder.addCleanup(t);

        async function createMethods() {
          const futureDatabase = await dbHolder.createDbInstance();
          const { methods } = createMethodMachine(futureDatabase);

          const { promise, resolve } = Promise.withResolvers<Future<string>>();
          const method = methods.create(
            'method',
            (dictionary: Future<string>) => {
              resolve(dictionary);
            }
          );

          const futureMachine = methods.build();

          return { futureDatabase, method, futureMachine, promise };
        }

        const value = '123';

        let futureId: FutureId<void>;

        {
          const { futureDatabase, method, futureMachine } =
            await createMethods();
          const { future, id } = futureMachine.withResolvers<void>();
          futureId = id;

          future.next(method.bind(futureMachine.resolve(value)));
          await dbHolder.close(futureDatabase);
        }

        {
          const { futureDatabase, futureMachine, promise } =
            await createMethods();
          futureMachine.resolveFutureById(futureId);
          const future: Future<string> = await promise;

          assert.strictEqual(await future.getPromise(), value);
          await dbHolder.close(futureDatabase);
        }
      });
    });
  });
};
