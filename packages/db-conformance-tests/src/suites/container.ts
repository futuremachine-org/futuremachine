/* eslint-disable @typescript-eslint/explicit-member-accessibility */
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  createMethodMachine,
  Entity,
  Exception,
  Struct,
} from '@futuremachine/core';

import type {
  AggregateException,
  Dictionary,
  Future,
  FutureFulfilledResult,
  FutureId,
  FutureSettledResult,
  List,
  Method,
  Serializable,
  StateBuilder,
} from '@futuremachine/core';
import type { TestSettings } from '../test_settings.js';

export default (testSettings: TestSettings) => {
  describe('Dictionary', () => {
    test('has basic functionality', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { containers, methods } = createMethodMachine(futureDatabase);

      methods.build();

      const dictionary = containers.createDictionary<number>();

      const key1 = 'Hello';
      const value1 = 1234;

      assert.strictEqual(dictionary.has(key1), false);
      assert.strictEqual(dictionary.get(key1), undefined);

      dictionary.set(key1, value1);

      assert.strictEqual(dictionary.has(key1), true);
      assert.strictEqual(dictionary.get(key1), value1);

      dictionary.delete(key1);

      assert.strictEqual(dictionary.has(key1), false);
      assert.strictEqual(dictionary.get(key1), undefined);

      const key2 = 'World';
      const value2 = 4321;

      assert.strictEqual(dictionary.has(key1), false);
      assert.strictEqual(dictionary.get(key1), undefined);
      assert.strictEqual(dictionary.has(key2), false);
      assert.strictEqual(dictionary.get(key2), undefined);

      dictionary.set(key1, value1);
      dictionary.set(key2, value2);

      assert.strictEqual(dictionary.has(key1), true);
      assert.strictEqual(dictionary.get(key1), value1);
      assert.strictEqual(dictionary.has(key2), true);
      assert.strictEqual(dictionary.get(key2), value2);

      dictionary.clear();

      assert.strictEqual(dictionary.has(key1), false);
      assert.strictEqual(dictionary.get(key1), undefined);
      assert.strictEqual(dictionary.has(key2), false);
      assert.strictEqual(dictionary.get(key2), undefined);

      await dbHolder.close(futureDatabase);
    });

    test('can be bound to Methods', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      const method = methods.create(
        'method',
        (dictionary: Dictionary<number>, key: string) => {
          return dictionary.get(key);
        }
      );

      const futureMachine = methods.build();

      const dictionary = containers.createDictionary<number>();

      const { future, resolve } = futureMachine.withResolvers<string>();

      const valueFuture = future.next(method.bindArgs(dictionary));

      const key = 'Hello';
      const value = 1234;

      dictionary.set(key, value);

      resolve(key);

      assert.strictEqual(await valueFuture.getPromise(), value);
      await dbHolder.close(futureDatabase);
    });

    test('can be bound to Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key = 'Hello';
      const value = 1234;

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<
          number | undefined
        >();
        const method = methods.create(
          'method',
          (dictionary: Dictionary<number>, key: string) => {
            resolve(dictionary.get(key));
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId: FutureId<string>;

      {
        const { containers, futureDatabase, method, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<string>();
        futureId = id;

        const dictionary = containers.createDictionary<number>();
        dictionary.set(key, value);

        future.next(method.bindArgs(dictionary));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId, key);

        assert.strictEqual(await promise, value);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can hold Futures across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Dictionary<Future<number>>>();
        const method = methods.create(
          'method',
          (dictionary: Dictionary<Future<number>>) => {
            resolve(dictionary);
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId: FutureId<void>;

      const key = 'Hello';
      const value = 1234;

      {
        const { containers, futureDatabase, method, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const dictionary = containers.createDictionary<Future<number>>();
        dictionary.set(key, futureMachine.resolve(value));

        future.next(method.bindArgs(dictionary));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const dictionary = await promise;
        assert.ok(dictionary.has(key));
        const future = dictionary.get(key)!;

        assert.strictEqual(await future.getPromise(), value);
        await dbHolder.close(futureDatabase);
      }
    });

    test('always returns the same instance of a Method until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type holderArg = Dictionary<Method<() => void>>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const method = methods.create('method', (_num: number) => {});

      const futureMachine = methods.build();

      const { future, id } = futureMachine.withResolvers<void>();

      const boundMethod = method.bindArgs(1);
      const original = containers.createDictionary<Method<() => void>>();
      original.set('key', boundMethod);

      future.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.get('key'), boundMethod);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a Future until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type holderArg = Dictionary<Future<number>>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const { future } = futureMachine.withResolvers<number>();
      const original = containers.createDictionary<Future<number>>();
      original.set('key', future);

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.get('key'), future);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of an Entity until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type stateType = Record<string, never>;
      class TestClass extends Entity<stateType> {}
      const createTest = methods.registerEntity(
        'test',
        TestClass,
        (stateBuilder: StateBuilder) => () => {
          const state = stateBuilder.build<stateType>({});
          return new TestClass(state);
        }
      );

      type holderArg = Dictionary<TestClass>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future, id } = futureMachine.withResolvers<void>();

      const test = createTest();
      const original = containers.createDictionary<TestClass>();
      original.set('key', test);

      future.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.get('key'), test);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a List until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type holderArg = Dictionary<List<number[]>>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const list = containers.createList<number[]>();
      const original = containers.createDictionary<List<number[]>>();
      original.set('key', list);

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.get('key'), list);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a Struct until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type structType = { num: number };
      type holderArg = Dictionary<Struct<structType>>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const value = containers.createStruct<structType>({ num: 1 });
      const original = containers.createDictionary<Struct<structType>>();
      original.set('key', value);

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.get('key'), value);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a Dictionary until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type holderArg = Dictionary<Dictionary<number>>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const value = containers.createDictionary<number>();
      const original = containers.createDictionary<Dictionary<number>>();
      original.set('key', value);

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.get('key'), value);

      await dbHolder.close(futureDatabase);
    });

    test('can hold Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const thunk = methods.create('thunk', (num: number) => {
          return num;
        });

        const { promise, resolve } =
          Promise.withResolvers<Dictionary<Method<() => number>>>();
        const holder = methods.create(
          'holder',
          (dictionary: Dictionary<Method<() => number>>) => {
            resolve(dictionary);
          }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          holder,
          thunk,
          futureMachine,
          promise,
        };
      }

      let futureId: FutureId<void>;

      const key = 'Hello';
      const value = 1234;

      {
        const { containers, futureDatabase, holder, thunk, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const dictionary = containers.createDictionary<Method<() => number>>();
        dictionary.set(key, thunk.bindArgs(value));

        future.next(holder.bindArgs(dictionary));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const dictionary = await promise;
        assert.ok(dictionary.has(key));
        const method = dictionary.get(key)!;

        assert.strictEqual(method(), value);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in a Future returned by FutureMachine.resolve across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key = 'Hello';
      const value = 1234;

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

      let futureId: FutureId<void>;

      {
        const { containers, futureDatabase, method, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const dictionary = containers.createDictionary<number>();
        dictionary.set(key, value);

        future.next(method.bindArgs(futureMachine.resolve(dictionary)));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);
        const future: Future<Dictionary<number>> = await promise;

        assert.strictEqual((await future.getPromise()).get(key), value);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in an AggregateDB of FutureMachine.all across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key1_1 = 'Hello';
      const value1_1 = 1234;
      const key1_2 = 'World';
      const value1_2 = 4321;
      const key2_1 = 'Fizz';
      const value2_1 = 111;

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<List<Dictionary<number>[]>>();
        const method = methods.create(
          'method',
          (dictionaries: List<Dictionary<number>[]>) => {
            resolve(dictionaries);
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId1: FutureId<Dictionary<number>>;
      let futureId2: FutureId<Dictionary<number>>;

      {
        const { futureDatabase, method, futureMachine } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<Dictionary<number>>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<Dictionary<number>>();
        futureId2 = id2;
        futureMachine.all([future1, future2]).next(method);
        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine } =
          await createMethods();
        const dictionary2 = containers.createDictionary<number>();

        futureMachine.resolveFutureById(futureId2, dictionary2);

        dictionary2.set(key2_1, value2_1);

        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine, promise } =
          await createMethods();

        const dictionary1 = containers.createDictionary<number>();

        futureMachine.resolveFutureById(futureId1, dictionary1);

        dictionary1.set(key1_1, value1_1);
        dictionary1.set(key1_2, value1_2);

        const dictionaries: List<Dictionary<number>[]> = await promise;

        assert.strictEqual(dictionaries.at(0).get(key1_1), value1_1);
        assert.strictEqual(dictionaries.at(0).get(key1_2), value1_2);
        assert.strictEqual(dictionaries.at(1).get(key2_1), value2_1);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in an AggregateDB of FutureMachine.allSettled across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key1_1 = 'Hello';
      const value1_1 = 1234;
      const key1_2 = 'World';
      const value1_2 = 4321;
      const key2_1 = 'Fizz';
      const value2_1 = 111;

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<
            List<FutureSettledResult<Dictionary<number>>[]>
          >();
        const method = methods.create(
          'method',
          (dictionaries: List<FutureSettledResult<Dictionary<number>>[]>) => {
            resolve(dictionaries);
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId1: FutureId<Dictionary<number>>;
      let futureId2: FutureId<Dictionary<number>>;

      {
        const { futureDatabase, method, futureMachine } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<Dictionary<number>>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<Dictionary<number>>();
        futureId2 = id2;
        futureMachine.allSettled([future1, future2]).next(method);
        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine } =
          await createMethods();
        const dictionary2 = containers.createDictionary<number>();

        futureMachine.resolveFutureById(futureId2, dictionary2);

        dictionary2.set(key2_1, value2_1);

        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine, promise } =
          await createMethods();

        const dictionary1 = containers.createDictionary<number>();

        futureMachine.resolveFutureById(futureId1, dictionary1);

        dictionary1.set(key1_1, value1_1);
        dictionary1.set(key1_2, value1_2);

        const dictionaries: List<FutureSettledResult<Dictionary<number>>[]> =
          await promise;

        assert.strictEqual(dictionaries.at(0).status, 'fulfilled');
        const result0 = dictionaries.at(0) as FutureFulfilledResult<
          Dictionary<number>
        >;
        assert.strictEqual(result0.value!.get(key1_1), value1_1);
        assert.strictEqual(result0.value!.get(key1_2), value1_2);
        assert.strictEqual(dictionaries.at(1).status, 'fulfilled');
        const result1 = dictionaries.at(1) as FutureFulfilledResult<
          Dictionary<number>
        >;
        assert.strictEqual(result1.value!.get(key2_1), value2_1);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in an AggregateDB of FutureMachine.any across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key1_1 = 'Hello';
      const value1_1 = 1234;
      const key1_2 = 'World';
      const value1_2 = 4321;
      const key2_1 = 'Fizz';
      const value2_1 = 111;

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<AggregateException>();
        const method = methods.create(
          'method',
          (exception: AggregateException) => {
            resolve(exception);
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId1: FutureId<Dictionary<number>>;
      let futureId2: FutureId<Dictionary<number>>;

      {
        const { futureDatabase, method, futureMachine } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<Dictionary<number>>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<Dictionary<number>>();
        futureId2 = id2;
        futureMachine.any([future1, future2]).catch(method);
        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine } =
          await createMethods();
        const dictionary2 = containers.createDictionary<number>();

        futureMachine.rejectFutureById(futureId2, dictionary2);

        dictionary2.set(key2_1, value2_1);

        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine, promise } =
          await createMethods();

        const dictionary1 = containers.createDictionary<number>();

        futureMachine.rejectFutureById(futureId1, dictionary1);

        dictionary1.set(key1_1, value1_1);
        dictionary1.set(key1_2, value1_2);

        const exception: AggregateException = await promise;

        const error1 = exception.errors.at(0) as Dictionary<number>;
        const error2 = exception.errors.at(1) as Dictionary<number>;

        assert.strictEqual(error1.get(key1_1), value1_1);
        assert.strictEqual(error1.get(key1_2), value1_2);
        assert.strictEqual(error2.get(key2_1), value2_1);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be updated across multiple Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<
          number | undefined
        >();
        const method = methods.create(
          'method',
          (dictionary: Dictionary<number>, key: string) => {
            resolve(dictionary.get(key));
          }
        );

        const updateMethod = methods.create(
          'updateMethod',
          (dictionary: Dictionary<number>, key: string, value: number) => {
            dictionary.set(key, value);
          }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          method,
          updateMethod,
          futureMachine,
          promise,
        };
      }

      let futureId1: FutureId<string>;
      let futureId2: FutureId<number>;
      const key = 'Hello';
      const value = 1234;

      {
        const {
          containers,
          futureDatabase,
          method,
          updateMethod,
          futureMachine,
        } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<string>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<number>();
        futureId2 = id2;

        const dictionary = containers.createDictionary<number>();

        future1.next(method.bindArgs(dictionary));
        future2.next(updateMethod.bindArgs(dictionary, key));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine } = await createMethods();
        futureMachine.resolveFutureById(futureId2, value);
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId1, key);

        assert.strictEqual(await promise, value);
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

      type containersType =
        | Dictionary<number>
        | List<string[]>
        | Struct<structType>
        | TestClass;

      const parentDictKey = 'Dict';
      const dictKey = 'World';
      const dictValue = 1234;

      const parentListKey = 'List';
      const listItem0 = 'hello';
      const listItem1 = 'world';

      const parentStructKey = 'Struct';

      const structValue1 = true;
      const structValue2 = 123;

      const parentEntityKey = 'Entity';
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
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Dictionary<containersType>>();
        const method = methods.create(
          'method',
          (dictionary: Dictionary<containersType>) => {
            resolve(dictionary);
          }
        );

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

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          futureMachine,
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
          futureMachine,
          method,
          createTest,
        } = await createMethods();
        const { future, id } = futureMachine.withResolvers<string>();
        futureId = id;

        const dictionary = containers.createDictionary<containersType>();

        const dictionaryEntry = containers.createDictionary<number>();

        const listEntry = containers.createList<string[]>(listItem0, listItem1);

        const structEntry = containers.createStruct<structType>({
          A: undefined,
          B: structValue2,
        });

        const entityEntry = createTest();

        dictionary.set(parentDictKey, dictionaryEntry);
        dictionary.set(parentListKey, listEntry);
        dictionary.set(parentStructKey, structEntry);
        dictionary.set(parentEntityKey, entityEntry);

        dictionaryEntry.set(dictKey, dictValue);
        structEntry.A = structValue1;
        entityEntry[entityKey1] = entityValue1;

        future.next(method.bindArgs(dictionary));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId, dictKey);

        const dictionary = await promise;

        const dictionaryEntry = dictionary.get(parentDictKey) as
          | Dictionary<number>
          | undefined;

        assert.notStrictEqual(dictionaryEntry, undefined);
        assert.strictEqual(dictionaryEntry!.get(dictKey), dictValue);

        const listEntry = dictionary.get(parentListKey) as
          | List<string[]>
          | undefined;

        assert.notStrictEqual(listEntry, undefined);
        assert.strictEqual(listEntry!.at(0), listItem0);
        assert.strictEqual(listEntry!.at(1), listItem1);

        const structEntry = dictionary.get(parentStructKey) as
          | Struct<structType>
          | undefined;

        assert.notStrictEqual(structEntry, undefined);
        assert.strictEqual(structEntry!.A, structValue1);
        assert.strictEqual(structEntry!.B, structValue2);

        const entityEntry = dictionary.get(parentEntityKey) as
          | TestClass
          | undefined;

        assert.notStrictEqual(entityEntry, undefined);
        assert.strictEqual(entityEntry![entityKey1], entityValue1);
        assert.strictEqual(entityEntry![entityKey2], entityValue2);

        await dbHolder.close(futureDatabase);
      }
    });

    test('can have itself as an entry', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      type entryType = number | Dictionary<entryType>;

      const dictKey = 'dict';
      const numberKey = 'number';
      const numberValue = 1234;

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Dictionary<entryType>>();
        const method = methods.create(
          'method',
          (dictionary: Dictionary<entryType>) => {
            resolve(dictionary);
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, futureMachine, method, promise };
      }

      let futureId: FutureId<void>;

      {
        const { containers, futureDatabase, futureMachine, method } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const dictionary = containers.createDictionary<entryType>();

        dictionary.set('number', numberValue);
        dictionary.set('dict', dictionary);

        future.next(method.bindArgs(dictionary));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const dictionary = await promise;

        {
          const numberEntry = dictionary.get(numberKey);
          assert.strictEqual(numberEntry, numberValue);
        }

        const dictEntry = dictionary.get(dictKey) as
          | Dictionary<entryType>
          | undefined;
        assert.notStrictEqual(dictEntry, undefined);
        assert.strictEqual(dictionary, dictEntry);

        {
          const numberEntry = dictEntry!.get(numberKey);
          assert.strictEqual(numberEntry, numberValue);
        }

        await dbHolder.close(futureDatabase);
      }
    });
  });

  describe('Struct', () => {
    test('has basic functionality', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      methods.build();

      const value1 = 1234;
      const value2 = 4321;

      type structType = {
        Hello: number | undefined;
        World: number;
      };

      const struct = containers.createStruct<structType>({
        Hello: undefined,
        World: value2,
      });

      assert.strictEqual(struct.Hello, undefined);
      struct.Hello = value1;
      assert.strictEqual(struct.Hello, value1);

      assert.strictEqual(struct.World, value2);
      await dbHolder.close(futureDatabase);
    });

    test('constructor works as expected', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      methods.build();
      const struct = containers.createStruct({});

      // By default is `Struct`.
      assert.strictEqual(struct.constructor, Struct);

      // Can be set.
      struct.constructor = Object;
      assert.strictEqual(struct.constructor, Object);

      // Can define it when creating it.
      const struct2 = containers.createStruct({
        constructor: 'Hello',
      });
      assert.strictEqual(struct2.constructor, 'Hello');

      await dbHolder.close(futureDatabase);
    });

    test('hasOwnProperty and related functions works as expected', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      methods.build();
      const struct = containers.createStruct({
        Hello: 1,
      });

      // Returns true for the properties defined in the struct.
      // eslint-disable-next-line no-prototype-builtins
      assert.ok(struct.hasOwnProperty('Hello'));
      // eslint-disable-next-line no-prototype-builtins
      assert.ok(!struct.hasOwnProperty('World' as 'Hello'));

      // Also works for `Object.hasOwn`.
      // Returns true for the properties defined in the struct.
      assert.ok(Object.hasOwn(struct, 'Hello'));
      assert.ok(!Object.hasOwn(struct, 'World' as 'Hello'));

      // Also works for `in`.
      // Returns true for the properties defined in the struct.
      assert.ok('Hello' in struct);
      assert.ok(!('World' in struct));
      assert.ok('hasOwnProperty' in struct);

      // Can be set.
      struct.hasOwnProperty = () => true;
      // eslint-disable-next-line no-prototype-builtins
      assert.ok(struct.hasOwnProperty('Hello'));
      // eslint-disable-next-line no-prototype-builtins
      assert.ok(struct.hasOwnProperty('World' as 'Hello'));

      // Can define it when creating it.
      const struct2 = containers.createStruct({
        hasOwnProperty: 'Hello',
      });
      assert.strictEqual(struct2.hasOwnProperty, 'Hello');

      await dbHolder.close(futureDatabase);
    });

    test('ownKeys and related functions works as expected', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      methods.build();

      const keys = ['Hello', 'World'] as const;
      const struct = containers.createStruct({
        [keys[0]]: 12,
        [keys[1]]: 34,
      });

      // Object.keys returns the keys of the database value.
      assert.deepStrictEqual(Object.keys(struct), keys);

      // Can iterate over the keys via `in`.
      let index = 0;
      for (const key in struct) {
        assert.strictEqual(key, keys[index]);
        index++;
      }

      // `Object.getOwnPropertyNames` returns the keys of the database value.
      assert.deepStrictEqual(Object.getOwnPropertyNames(struct), keys);

      // `Object.getOwnPropertySymbols` returns nothing since the database value
      // can't have symbols.
      assert.deepStrictEqual(Object.getOwnPropertySymbols(struct), []);

      await dbHolder.close(futureDatabase);
    });

    test("changing the JS object it was constructed with, doesn't change the underlying value", async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      methods.build();

      const value2 = 4321;

      type structType = {
        Hello: number | undefined;
        World: number;
      };

      const constructorObject: structType = {
        Hello: undefined,
        World: value2,
      };

      const struct = containers.createStruct<structType>(constructorObject);

      assert.strictEqual(struct.Hello, undefined);
      assert.strictEqual(struct.World, value2);

      constructorObject.Hello = 123;
      constructorObject.World = 321;

      assert.strictEqual(struct.Hello, undefined);
      assert.strictEqual(struct.World, value2);

      await dbHolder.close(futureDatabase);
    });

    test('modifying the object that was passed to the createStruct does not modify the struct it created', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      methods.build();

      const value1 = 1234;
      const value2_1 = 4321;
      const value2_2 = 555;

      type structType = {
        Hello: number | undefined;
        World: number;
      };

      const structObject = {
        Hello: undefined,
        World: value2_1,
      };

      const struct = containers.createStruct<structType>(structObject);

      assert.strictEqual(struct.Hello, undefined);
      struct.Hello = value1;

      structObject.World = value2_2;

      assert.strictEqual(struct.World, value2_1);
      await dbHolder.close(futureDatabase);
    });

    test('can be bound to Methods', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      const value1 = 1234;
      const value2 = 4321;

      type structType = {
        Hello: number | undefined;
        World: number;
      };

      const method = methods.create(
        'method',
        (struct: Struct<structType>, key: keyof structType) => {
          return struct[key];
        }
      );

      const futureMachine = methods.build();

      const struct = containers.createStruct<structType>({
        Hello: undefined,
        World: value2,
      });

      const { future, resolve } =
        futureMachine.withResolvers<keyof structType>();

      const valueFuture = future.next(method.bindArgs(struct));

      struct.Hello = value1;

      resolve('Hello');

      assert.strictEqual(await valueFuture.getPromise(), value1);
    });

    test('can be bound to Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const value2 = 4321;

      type structType = {
        Hello: number | undefined;
        World: number;
      };

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<
          number | undefined
        >();
        const method = methods.create(
          'method',
          (struct: Struct<structType>, key: keyof structType) => {
            resolve(struct[key]);
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId: FutureId<keyof structType>;

      {
        const { containers, futureDatabase, method, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<keyof structType>();
        futureId = id;

        const struct = containers.createStruct<structType>({
          Hello: undefined,
          World: value2,
        });

        future.next(method.bindArgs(struct));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId, 'World');

        assert.strictEqual(await promise, value2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can hold Futures across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const value = 4321;

      type structType = {
        Hello: Future<number>;
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
          Hello: futureMachine.resolve(value),
        });

        future.next(method.bindArgs(struct));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const struct = await promise;
        const future = struct.Hello!;

        assert.strictEqual(await future.getPromise(), value);
        await dbHolder.close(futureDatabase);
      }
    });

    test('always returns the same instance of a Method until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type structType = { boundMethod: Method<() => void> };
      type holderArg = Struct<structType>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const method = methods.create('method', (_num: number) => {});

      const futureMachine = methods.build();

      const { future, id } = futureMachine.withResolvers<void>();

      const boundMethod = method.bindArgs(1);
      const original = containers.createStruct<structType>({
        boundMethod,
      });

      future.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.boundMethod, boundMethod);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a Future until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type structType = { future: Future<number> };
      type holderArg = Struct<structType>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const { future } = futureMachine.withResolvers<number>();
      const original = containers.createStruct({
        future,
      });

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.future, future);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of an Entity until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type stateType = Record<string, never>;
      class TestClass extends Entity<stateType> {}
      const createTest = methods.registerEntity(
        'test',
        TestClass,
        (stateBuilder: StateBuilder) => () => {
          const state = stateBuilder.build<stateType>({});
          return new TestClass(state);
        }
      );

      type structType = { test: TestClass };
      type holderArg = Struct<structType>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future, id } = futureMachine.withResolvers<void>();

      const test = createTest();
      const original = containers.createStruct<structType>({
        test,
      });

      future.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.test, test);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a List until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type structType = { list: List<number[]> };
      type holderArg = Struct<structType>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const list = containers.createList<number[]>();
      const original = containers.createStruct<structType>({
        list,
      });

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.list, list);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a Struct until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type structType = { num: number };

      type structHolderType = { value: Struct<structType> };
      type holderArg = Struct<structHolderType>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const value = containers.createStruct<structType>({ num: 1 });
      const original = containers.createStruct<structHolderType>({ value });

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.value, value);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a Dictionary until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type structType = { value: Dictionary<number> };
      type holderArg = Struct<structType>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const value = containers.createDictionary<number>();
      const original = containers.createStruct<structType>({ value });

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.value, value);

      await dbHolder.close(futureDatabase);
    });

    test('can hold Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const value = 4321;

      type structType = {
        Hello: Method<() => number>;
      };

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const thunk = methods.create('thunk', (num: number) => {
          return num;
        });

        const { promise, resolve } =
          Promise.withResolvers<Struct<structType>>();
        const holder = methods.create(
          'holder',
          (struct: Struct<structType>) => {
            resolve(struct);
          }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          holder,
          thunk,
          futureMachine,
          promise,
        };
      }

      let futureId: FutureId<void>;

      {
        const { containers, futureDatabase, holder, thunk, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const struct = containers.createStruct<structType>({
          Hello: thunk.bindArgs(value),
        });

        future.next(holder.bindArgs(struct));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const struct = await promise;
        const method = struct.Hello!;

        assert.strictEqual(method(), value);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in a Future returned by FutureMachine.resolve across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const value2 = 4321;

      type structType = {
        Hello: number | undefined;
        World: number;
      };

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Future<Struct<structType>>>();
        const method = methods.create(
          'method',
          (dictionary: Future<Struct<structType>>) => {
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

        const struct = containers.createStruct<structType>({
          Hello: undefined,
          World: value2,
        });

        future.next(method.bindArgs(futureMachine.resolve(struct)));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);
        const future: Future<Struct<structType>> = await promise;

        assert.strictEqual((await future.getPromise()).Hello, undefined);
        assert.strictEqual((await future.getPromise()).World, value2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in an AggregateDB of FutureMachine.all across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const value1_1 = 1234;
      const value1_2 = 4321;
      const value2_2 = 111;

      type structType = {
        Hello: number | undefined;
        World: number;
      };

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<List<Struct<structType>[]>>();
        const method = methods.create(
          'method',
          (structs: List<Struct<structType>[]>) => {
            resolve(structs);
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId1: FutureId<Struct<structType>>;
      let futureId2: FutureId<Struct<structType>>;

      {
        const { futureDatabase, method, futureMachine } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<Struct<structType>>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<Struct<structType>>();
        futureId2 = id2;
        futureMachine.all([future1, future2]).next(method);
        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine } =
          await createMethods();
        const struct2 = containers.createStruct<structType>({
          Hello: undefined,
          World: value2_2,
        });

        futureMachine.resolveFutureById(futureId2, struct2);

        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine, promise } =
          await createMethods();

        const struct1 = containers.createStruct<structType>({
          Hello: undefined,
          World: value1_2,
        });

        futureMachine.resolveFutureById(futureId1, struct1);

        struct1.Hello = value1_1;

        const structs: List<Struct<structType>[]> = await promise;

        assert.strictEqual(structs.at(0).Hello, value1_1);
        assert.strictEqual(structs.at(0).World, value1_2);
        assert.strictEqual(structs.at(1).Hello, undefined);
        assert.strictEqual(structs.at(1).World, value2_2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in an AggregateDB of FutureMachine.allSettled across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const value1_1 = 1234;
      const value1_2 = 4321;
      const value2_2 = 111;

      type structType = {
        Hello: number | undefined;
        World: number;
      };

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<
            List<FutureSettledResult<Struct<structType>>[]>
          >();
        const method = methods.create(
          'method',
          (structs: List<FutureSettledResult<Struct<structType>>[]>) => {
            resolve(structs);
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId1: FutureId<Struct<structType>>;
      let futureId2: FutureId<Struct<structType>>;

      {
        const { futureDatabase, method, futureMachine } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<Struct<structType>>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<Struct<structType>>();
        futureId2 = id2;
        futureMachine.allSettled([future1, future2]).next(method);
        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine } =
          await createMethods();
        const struct2 = containers.createStruct<structType>({
          Hello: undefined,
          World: value2_2,
        });

        futureMachine.resolveFutureById(futureId2, struct2);

        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine, promise } =
          await createMethods();

        const struct1 = containers.createStruct<structType>({
          Hello: undefined,
          World: value1_2,
        });

        futureMachine.resolveFutureById(futureId1, struct1);

        struct1.Hello = value1_1;

        const structs: List<FutureSettledResult<Struct<structType>>[]> =
          await promise;

        assert.strictEqual(structs.at(0).status, 'fulfilled');
        const result0 = structs.at(0) as FutureFulfilledResult<
          Struct<structType>
        >;
        assert.strictEqual(result0.value!.Hello, value1_1);
        assert.strictEqual(result0.value!.World, value1_2);
        assert.strictEqual(structs.at(1).status, 'fulfilled');
        const result1 = structs.at(1) as FutureFulfilledResult<
          Struct<structType>
        >;
        assert.strictEqual(result1.value!.Hello, undefined);
        assert.strictEqual(result1.value!.World, value2_2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in an AggregateDB of FutureMachine.any across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const value1_1 = 1234;
      const value1_2 = 4321;
      const value2_2 = 111;

      type structType = {
        Hello: number | undefined;
        World: number;
      };

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<AggregateException>();
        const method = methods.create(
          'method',
          (exception: AggregateException) => {
            resolve(exception);
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId1: FutureId<Struct<structType>>;
      let futureId2: FutureId<Struct<structType>>;

      {
        const { futureDatabase, method, futureMachine } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<Struct<structType>>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<Struct<structType>>();
        futureId2 = id2;
        futureMachine.any([future1, future2]).catch(method);
        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine } =
          await createMethods();
        const struct2 = containers.createStruct<structType>({
          Hello: undefined,
          World: value2_2,
        });

        futureMachine.rejectFutureById(futureId2, struct2);

        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine, promise } =
          await createMethods();

        const struct1 = containers.createStruct<structType>({
          Hello: undefined,
          World: value1_2,
        });

        futureMachine.rejectFutureById(futureId1, struct1);

        struct1.Hello = value1_1;

        const exception: AggregateException = await promise;

        const error1 = exception.errors.at(0) as Struct<structType>;
        const error2 = exception.errors.at(1) as Struct<structType>;

        assert.strictEqual(error1.World, value1_2);
        assert.strictEqual(error2.Hello, undefined);
        assert.strictEqual(error2.World, value2_2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be updated across multiple Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const value1 = 1234;
      const value2 = 4321;

      type structType = {
        Hello: number | undefined;
        World: number;
      };

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<
          number | undefined
        >();
        const method = methods.create(
          'method',
          (struct: Struct<structType>, key: keyof structType) => {
            resolve(struct[key]);
          }
        );

        const updateMethod = methods.create(
          'updateMethod',
          (
            struct: Struct<structType>,
            key: keyof structType,
            value: number
          ) => {
            struct[key] = value;
          }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          method,
          updateMethod,
          futureMachine,
          promise,
        };
      }

      let futureId1: FutureId<keyof structType>;
      let futureId2: FutureId<number>;

      {
        const {
          containers,
          futureDatabase,
          method,
          updateMethod,
          futureMachine,
        } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<keyof structType>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<number>();
        futureId2 = id2;

        const struct = containers.createStruct<structType>({
          Hello: undefined,
          World: value2,
        });

        future1.next(method.bindArgs(struct));
        future2.next(updateMethod.bindArgs(struct, 'Hello'));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine } = await createMethods();
        futureMachine.resolveFutureById(futureId2, value1);
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId1, 'Hello');

        assert.strictEqual(await promise, value1);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can have containers as entries', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      type entryStructType = {
        A: boolean | undefined;
        B: number;
      };

      type stateType = {
        [entityKey1]: number | undefined;
        [entityKey2]: number;
      };

      const parentDictKey = 'Dict';
      const dictKey = 'World';
      const dictValue = 1234;

      const parentListKey = 'List';
      const listItem0 = 'hello';
      const listItem1 = 'world';

      const parentStructKey = 'Struct';

      const structValue1 = true;
      const structValue2 = 123;

      const parentEntityKey = 'Entity';
      const entityKey1 = 'Hello';
      const entityValue1 = 1234;

      const entityKey2 = 'World';
      const entityValue2 = 4321;

      type structType = {
        [parentDictKey]: Dictionary<number>;
        [parentListKey]: List<string[]>;
        [parentStructKey]: Struct<entryStructType>;
        [parentEntityKey]: TestClass;
      };

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
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Struct<structType>>();
        const method = methods.create(
          'method',
          (struct: Struct<structType>) => {
            resolve(struct);
          }
        );

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

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          futureMachine,
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
          futureMachine,
          method,
          createTest,
        } = await createMethods();
        const { future, id } = futureMachine.withResolvers<string>();
        futureId = id;

        const dictionaryEntry = containers.createDictionary<number>();

        const listEntry = containers.createList<string[]>(listItem0, listItem1);

        const structEntry = containers.createStruct<entryStructType>({
          A: undefined,
          B: structValue2,
        });

        const entityEntry = createTest();

        const struct = containers.createStruct<structType>({
          [parentDictKey]: dictionaryEntry,
          [parentListKey]: listEntry,
          [parentStructKey]: structEntry,
          [parentEntityKey]: entityEntry,
        });

        dictionaryEntry.set(dictKey, dictValue);
        structEntry.A = structValue1;
        entityEntry[entityKey1] = entityValue1;

        future.next(method.bindArgs(struct));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId, dictKey);

        const struct = await promise;

        const dictionaryEntry = struct[parentDictKey] as
          | Dictionary<number>
          | undefined;

        assert.notStrictEqual(dictionaryEntry, undefined);
        assert.strictEqual(dictionaryEntry!.get(dictKey), dictValue);

        const listEntry = struct[parentListKey] as List<string[]> | undefined;

        assert.notStrictEqual(listEntry, undefined);
        assert.strictEqual(listEntry!.at(0), listItem0);
        assert.strictEqual(listEntry!.at(1), listItem1);

        const structEntry = struct[parentStructKey] as
          | Struct<entryStructType>
          | undefined;

        assert.notStrictEqual(structEntry, undefined);
        assert.strictEqual(structEntry!.A, structValue1);
        assert.strictEqual(structEntry!.B, structValue2);

        const entityEntry = struct[parentEntityKey] as TestClass | undefined;

        assert.notStrictEqual(entityEntry, undefined);
        assert.strictEqual(entityEntry![entityKey1], entityValue1);
        assert.strictEqual(entityEntry![entityKey2], entityValue2);

        await dbHolder.close(futureDatabase);
      }
    });

    test('can have itself as an entry', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      type structType = {
        Hello: Struct<structType> | undefined;
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
        const { containers, futureDatabase, futureMachine, method } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const struct = containers.createStruct<structType>({
          Hello: undefined,
        });
        struct.Hello = struct;

        future.next(method.bindArgs(struct));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const struct = await promise;

        const structEntry = struct.Hello;
        assert.notStrictEqual(structEntry, undefined);
        assert.strictEqual(struct, structEntry);

        await dbHolder.close(futureDatabase);
      }
    });
  });

  describe('List', () => {
    test('has basic functionality', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      methods.build();

      const list = containers.createList<number[]>();

      const elements = [1234, 88, 438, 574];
      list.push(...elements);

      assert.strictEqual(list.length, elements.length);
      assert.strictEqual(list.size(), elements.length);

      assert.deepStrictEqual([...list], elements);

      assert.strictEqual(list.at(-1), elements.at(-1));
      assert.strictEqual(list.pop(), elements.at(-1));

      let i = 0;
      for (const value of list.values()) {
        assert.strictEqual(value, elements[i]);
        i++;
      }

      await dbHolder.close(futureDatabase);
    });

    test("changing the JS object it was constructed with, doesn't change the underlying value", async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      methods.build();

      const elements = [1234, 88, 438, 574];
      const elementsCopy = [...elements];
      const list = containers.createList<number[]>(...elementsCopy);

      assert.strictEqual(list.length, elements.length);
      assert.deepStrictEqual([...list], elements);

      elementsCopy[0] = 1;
      elementsCopy[1] = 2;
      elementsCopy[2] = 3;
      elementsCopy.pop();

      assert.strictEqual(list.length, elements.length);
      assert.deepStrictEqual([...list], elements);

      await dbHolder.close(futureDatabase);
    });

    test('can initialize with elements', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      methods.build();

      const elements = [1234, 88, 438, 574];
      const list = containers.createList<number[]>(...elements);

      assert.deepStrictEqual([...list], elements);

      await dbHolder.close(futureDatabase);
    });

    test('can be a tuple', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      methods.build();

      // TODO: I tried doing this with 'as const' but it added a readonly. I
      // think I want to remove the readonly from the List returned from
      // elements.
      const elements: [string, number] = ['Hello', 123];
      // TODO: Should we have a separate function called createTuple that will
      // let us pass in the actual array?
      const list = containers.createList(...elements);

      const element0: string = list.at(0);
      const element1: number = list.at(1);

      assert.strictEqual(element0, elements.at(0));
      assert.strictEqual(element1, elements.at(1));

      await dbHolder.close(futureDatabase);
    });

    test('can be mapped with a js function', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      methods.build();

      const elements = [1234, 88, 438, 574];
      const list = containers.createList<number[]>(...elements);

      const mapFunc = (num: number) => num.toString();

      const test = list.map(mapFunc);

      assert.deepStrictEqual([...test.values()], elements.map(mapFunc));

      await dbHolder.close(futureDatabase);
    });

    test('can be mapped with a Method', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      const mapMethod = methods
        .create('mapMethod', (str: string, num: number) => str + num.toString())
        .bindArgs('Hello: ');

      methods.build();

      const elements = [1234, 88, 438, 574];
      const list = containers.createList<number[]>(...elements);

      const test = list.map(mapMethod);

      assert.deepStrictEqual([...test.values()], elements.map(mapMethod));

      await dbHolder.close(futureDatabase);
    });

    test('can update elements with set', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      methods.build();

      const elements = [1234, 88, 438, 574];
      const list = containers.createList<number[]>(...elements);

      const newValues = [999, 102];

      list.set(newValues, 1);

      const newElements = [
        elements[0],
        newValues[0],
        newValues[1],
        elements[3],
      ];

      assert.deepStrictEqual([...list.values()], newElements);

      await dbHolder.close(futureDatabase);
    });

    test('can be bound to Methods', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      const method = methods.create(
        'method',
        (list: List<number[]>, index: number) => {
          return list.at(index);
        }
      );

      const futureMachine = methods.build();

      const list = containers.createList<number[]>();

      const { future, resolve } = futureMachine.withResolvers<number>();

      const valueFuture = future.next(method.bindArgs(list));

      const elements = [1234, 88, 438, 574];

      list.push(...elements);

      const index = 2;
      resolve(index);

      assert.strictEqual(await valueFuture.getPromise(), elements[index]);
    });

    test('can be bound to Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const index = 2;
      const elements = [1234, 88, 438, 574];

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<
          number | undefined
        >();
        const method = methods.create(
          'method',
          (list: List<number[]>, index: number) => {
            resolve(list.at(index));
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId: FutureId<number>;

      {
        const { containers, futureDatabase, method, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<number>();
        futureId = id;

        const list = containers.createList<number[]>();
        list.push(...elements);

        future.next(method.bindArgs(list));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId, index);

        assert.strictEqual(await promise, elements[index]);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can hold Futures across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<List<Future<number>[]>>();
        const method = methods.create(
          'method',
          (struct: List<Future<number>[]>) => {
            resolve(struct);
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId: FutureId<void>;
      const value = 4321;

      {
        const { containers, futureDatabase, method, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const list = containers.createList<Future<number>[]>(
          futureMachine.resolve(value)
        );

        future.next(method.bindArgs(list));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const list = await promise;
        const future = list.at(0);

        assert.strictEqual(await future.getPromise(), value);
        await dbHolder.close(futureDatabase);
      }
    });

    test('always returns the same instance of a Method until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type listType = Method<() => void>[];
      type holderArg = List<listType>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const method = methods.create('method', (_num: number) => {});

      const futureMachine = methods.build();

      const { future, id } = futureMachine.withResolvers<void>();

      const boundMethod = method.bindArgs(1);
      const original = containers.createList<listType>(boundMethod);

      future.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.at(0), boundMethod);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a Method until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type listType = Future<number>[];
      type holderArg = List<listType>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const { future } = futureMachine.withResolvers<number>();
      const original = containers.createList<listType>(future);

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.at(0), future);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of an Entity until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type stateType = Record<string, never>;
      class TestClass extends Entity<stateType> {}
      const createTest = methods.registerEntity(
        'test',
        TestClass,
        (stateBuilder: StateBuilder) => () => {
          const state = stateBuilder.build<stateType>({});
          return new TestClass(state);
        }
      );

      type listType = TestClass[];
      type holderArg = List<listType>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future, id } = futureMachine.withResolvers<void>();

      const test = createTest();
      const original = containers.createList<listType>(test);

      future.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.at(0), test);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a List until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type listType = List<number[]>[];
      type holderArg = List<listType>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const list = containers.createList<number[]>();
      const original = containers.createList<listType>(list);

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.at(0), list);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a List until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type structType = { num: number };

      type listType = Struct<structType>[];
      type holderArg = List<listType>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const value = containers.createStruct<structType>({ num: 1 });
      const original = containers.createList<listType>(value);

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.at(0), value);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a Dictionary until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type listType = Dictionary<number>[];
      type holderArg = List<listType>;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const value = containers.createDictionary<number>();
      const original = containers.createList<listType>(value);

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.at(0), value);

      await dbHolder.close(futureDatabase);
    });

    test('can hold Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const thunk = methods.create('thunk', (num: number) => {
          return num;
        });

        const { promise, resolve } =
          Promise.withResolvers<List<Method<() => number>[]>>();
        const holder = methods.create(
          'holder',
          (list: List<Method<() => number>[]>) => {
            resolve(list);
          }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          holder,
          thunk,
          futureMachine,
          promise,
        };
      }

      let futureId: FutureId<void>;
      const value = 4321;

      {
        const { containers, futureDatabase, holder, thunk, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const list = containers.createList<Method<() => number>[]>(
          thunk.bindArgs(value)
        );

        future.next(holder.bindArgs(list));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const list = await promise;
        const method = list.at(0);

        assert.strictEqual(method(), value);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in a Future returned by FutureMachine.resolve across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const elements = [1234, 88, 438, 574];

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Future<List<number[]>>>();
        const method = methods.create(
          'method',
          (dictionary: Future<List<number[]>>) => {
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

        const list = containers.createList<number[]>();
        list.push(...elements);

        future.next(method.bindArgs(futureMachine.resolve(list)));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);
        const future: Future<List<number[]>> = await promise;

        assert.deepStrictEqual([...(await future.getPromise())], elements);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in an AggregateDB of FutureMachine.all across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const elements1 = [1234, 88, 438, 574];
      const elements2 = [55, 33, 2929, 4023, 7];

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<List<List<number[]>[]>>();
        const method = methods.create(
          'method',
          (dictionaries: List<List<number[]>[]>) => {
            resolve(dictionaries);
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId1: FutureId<List<number[]>>;
      let futureId2: FutureId<List<number[]>>;

      {
        const { futureDatabase, method, futureMachine } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<List<number[]>>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<List<number[]>>();
        futureId2 = id2;
        futureMachine.all([future1, future2]).next(method);
        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine } =
          await createMethods();
        const list2 = containers.createList<number[]>();

        futureMachine.resolveFutureById(futureId2, list2);

        list2.push(...elements2);

        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine, promise } =
          await createMethods();

        const list1 = containers.createList<number[]>();

        futureMachine.resolveFutureById(futureId1, list1);

        list1.push(...elements1);

        const lists: List<List<number[]>[]> = await promise;

        assert.deepStrictEqual([...lists.at(0)], elements1);
        assert.deepStrictEqual([...lists.at(1)], elements2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in an AggregateDB of FutureMachine.allSettled across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const elements1 = [1234, 88, 438, 574];
      const elements2 = [55, 33, 2929, 4023, 7];

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<List<FutureSettledResult<List<number[]>>[]>>();
        const method = methods.create(
          'method',
          (dictionaries: List<FutureSettledResult<List<number[]>>[]>) => {
            resolve(dictionaries);
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId1: FutureId<List<number[]>>;
      let futureId2: FutureId<List<number[]>>;

      {
        const { futureDatabase, method, futureMachine } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<List<number[]>>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<List<number[]>>();
        futureId2 = id2;
        futureMachine.allSettled([future1, future2]).next(method);
        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine } =
          await createMethods();
        const list2 = containers.createList<number[]>();

        futureMachine.resolveFutureById(futureId2, list2);

        list2.push(...elements2);

        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine, promise } =
          await createMethods();

        const list1 = containers.createList<number[]>();

        futureMachine.resolveFutureById(futureId1, list1);

        list1.push(...elements1);

        const lists: List<FutureSettledResult<List<number[]>>[]> =
          await promise;

        assert.deepStrictEqual(lists.at(0).status, 'fulfilled');
        const result0 = lists.at(0) as FutureFulfilledResult<List<number[]>>;
        assert.deepStrictEqual([...result0.value!], elements1);
        assert.deepStrictEqual(lists.at(1).status, 'fulfilled');
        const result1 = lists.at(1) as FutureFulfilledResult<List<number[]>>;
        assert.deepStrictEqual([...result1.value!], elements2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in an AggregateDB of FutureMachine.any across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const elements1 = [1234, 88, 438, 574];
      const elements2 = [55, 33, 2929, 4023, 7];

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<AggregateException>();
        const method = methods.create(
          'method',
          (exception: AggregateException) => {
            resolve(exception);
          }
        );

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId1: FutureId<List<number[]>>;
      let futureId2: FutureId<List<number[]>>;

      {
        const { futureDatabase, method, futureMachine } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<List<number[]>>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<List<number[]>>();
        futureId2 = id2;
        futureMachine.any([future1, future2]).catch(method);
        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine } =
          await createMethods();
        const list2 = containers.createList<number[]>();

        futureMachine.rejectFutureById(futureId2, list2);

        list2.push(...elements2);

        await dbHolder.close(futureDatabase);
      }

      {
        const { containers, futureDatabase, futureMachine, promise } =
          await createMethods();

        const list1 = containers.createList<number[]>();

        futureMachine.rejectFutureById(futureId1, list1);

        list1.push(...elements1);

        const exception: AggregateException = await promise;

        const error1 = exception.errors.at(0) as List<number[]>;
        const error2 = exception.errors.at(1) as List<number[]>;

        assert.deepStrictEqual([...error1], elements1);
        assert.deepStrictEqual([...error2], elements2);
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

      type containersType =
        | Dictionary<number>
        | List<string[]>
        | Struct<structType>
        | TestClass;

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
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<List<containersType[]>>();
        const method = methods.create(
          'method',
          (list: List<containersType[]>) => {
            resolve(list);
          }
        );

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

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          futureMachine,
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
          futureMachine,
          method,
          createTest,
        } = await createMethods();
        const { future, id } = futureMachine.withResolvers<string>();
        futureId = id;

        const list = containers.createList<containersType[]>();

        const dictionaryEntry = containers.createDictionary<number>();

        const listEntry = containers.createList<string[]>(listItem0, listItem1);

        const structEntry = containers.createStruct<structType>({
          A: undefined,
          B: structValue2,
        });

        const entityEntry = createTest();

        list.push(dictionaryEntry, listEntry, structEntry, entityEntry);

        dictionaryEntry.set(dictKey, dictValue);
        structEntry.A = structValue1;
        entityEntry[entityKey1] = entityValue1;

        future.next(method.bindArgs(list));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId, dictKey);

        const dictionary = await promise;

        const dictionaryEntry = dictionary.at(0) as
          | Dictionary<number>
          | undefined;

        assert.notStrictEqual(dictionaryEntry, undefined);
        assert.strictEqual(dictionaryEntry!.get(dictKey), dictValue);

        const listEntry = dictionary.at(1) as List<string[]> | undefined;

        assert.notStrictEqual(listEntry, undefined);
        assert.strictEqual(listEntry!.at(0), listItem0);
        assert.strictEqual(listEntry!.at(1), listItem1);

        const structEntry = dictionary.at(2) as Struct<structType> | undefined;

        assert.notStrictEqual(structEntry, undefined);
        assert.strictEqual(structEntry!.A, structValue1);
        assert.strictEqual(structEntry!.B, structValue2);

        const entityEntry = dictionary.at(3) as TestClass | undefined;

        assert.notStrictEqual(entityEntry, undefined);
        assert.strictEqual(entityEntry![entityKey1], entityValue1);
        assert.strictEqual(entityEntry![entityKey2], entityValue2);

        await dbHolder.close(futureDatabase);
      }
    });

    test('can have itself as an entry', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      type listType = List<listType[]>;

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<listType>();
        const method = methods.create('method', (list: listType) => {
          resolve(list);
        });

        const futureMachine = methods.build();

        return { containers, futureDatabase, method, futureMachine, promise };
      }

      let futureId: FutureId<void>;

      {
        const { containers, futureDatabase, futureMachine, method } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const list = containers.createList<listType[]>();
        list.push(list);

        future.next(method.bindArgs(list));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const list = await promise;

        const listEntry = list.at(0);
        assert.notStrictEqual(listEntry, undefined);
        assert.strictEqual(list, listEntry);

        await dbHolder.close(futureDatabase);
      }
    });
  });

  describe('Entity', () => {
    test('has basic functionality', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods } = createMethodMachine(futureDatabase);

      const key1 = 'Hello';
      const value1 = 1234;

      const key2 = 'World';
      const value2 = 4321;

      type stateType<T extends Serializable> = {
        [key1]: T | undefined;
        [key2]: number;
      };

      class TestClass<T extends Serializable> extends Entity<stateType<T>> {
        get [key1]() {
          return this.get(key1);
        }
        set [key1](value: T | undefined) {
          this.set(key1, value);
        }
        get [key2]() {
          return this.get(key2);
        }
      }

      const createTest = methods.registerEntity(
        'test',
        TestClass,
        (stateBuilder: StateBuilder) =>
          <T extends Serializable>(value1: T) => {
            const state = stateBuilder.build({
              [key1]: value1,
              [key2]: value2,
            });
            return new TestClass(state);
          }
      );
      const instance = createTest(value1);

      assert.strictEqual(instance[key1], value1);
      assert.strictEqual(instance[key2], value2);

      instance[key1] = undefined;

      assert.strictEqual(instance[key1], undefined);
    });

    test("changing the JS object it was constructed with, doesn't change the underlying value", async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods } = createMethodMachine(futureDatabase);

      const key1 = 'Hello';
      const value1 = 1234;

      const key2 = 'World';
      const value2 = 4321;

      type stateType = {
        [key1]: number | undefined;
        [key2]: number;
      };

      const testClassState: stateType = {
        [key1]: value1,
        [key2]: value2,
      };

      class TestClass extends Entity<stateType> {
        get [key1]() {
          return this.get(key1);
        }
        get [key2]() {
          return this.get(key2);
        }
      }

      const createTest = methods.registerEntity(
        'test',
        TestClass,
        (stateBuilder: StateBuilder) => () => {
          const state = stateBuilder.build(testClassState);
          return new TestClass(state);
        }
      );
      const instance = createTest();

      assert.strictEqual(instance[key1], value1);
      assert.strictEqual(instance[key2], value2);

      testClassState[key1] = 1;
      testClassState[key2] = 2;

      assert.strictEqual(instance[key1], value1);
      assert.strictEqual(instance[key2], value2);
    });

    test("modifying the object that was passed to the StateBuilder.build does not modify the entity it's for", async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods } = createMethodMachine(futureDatabase);

      const key1 = 'Hello';
      const value1 = 1234;

      const key2 = 'World';
      const value2 = 4321;

      type stateType<T extends Serializable> = {
        [key1]: T | undefined;
        [key2]: number;
      };

      const stateObject: stateType<number> = {
        [key1]: value1,
        [key2]: value2,
      };

      class TestClass<T extends Serializable> extends Entity<stateType<T>> {
        get [key1]() {
          return this.get(key1);
        }
        set [key1](value: T | undefined) {
          this.set(key1, value);
        }
        get [key2]() {
          return this.get(key2);
        }
      }

      const createTest = methods.registerEntity(
        'test',
        TestClass,
        (stateBuilder: StateBuilder) => () => {
          const state = stateBuilder.build(stateObject);
          return new TestClass(state);
        }
      );
      const instance = createTest();

      assert.strictEqual(instance[key1], value1);
      assert.strictEqual(instance[key2], value2);

      stateObject[key1] = undefined;

      assert.strictEqual(instance[key1], value1);
    });

    test('can be bound to Methods', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods } = createMethodMachine(futureDatabase);

      const key1 = 'Hello';
      const value1 = 1234;

      const key2 = 'World';
      const value2 = 4321;

      type stateType<T extends Serializable> = {
        [key1]: T | undefined;
        [key2]: number;
      };

      class TestClass<T extends Serializable> extends Entity<stateType<T>> {
        get [key1]() {
          return this.get(key1);
        }
        set [key1](value: T | undefined) {
          this.set(key1, value);
        }
        get [key2]() {
          return this.get(key2);
        }
      }

      const createTest = methods.registerEntity(
        'test',
        TestClass,
        (stateBuilder: StateBuilder) =>
          <T extends Serializable>(value1: T) => {
            const state = stateBuilder.build({
              [key1]: value1,
              [key2]: value2,
            });
            return new TestClass(state);
          }
      );

      const method = methods.create(
        'method',
        <T extends Serializable>(
          struct: TestClass<T>,
          key: keyof stateType<T>
        ) => {
          return struct[key];
        }
      );

      const futureMachine = methods.build();

      const instance = createTest(value1);

      const { future, resolve } =
        futureMachine.withResolvers<keyof stateType<number>>();

      const valueFuture = future.next(
        method.bindArgs(instance) as Method<
          (key: keyof stateType<number>) => number | undefined
        >
      );

      instance[key1] = value1;

      resolve(key1);

      assert.strictEqual(await valueFuture.getPromise(), value1);
    });

    test('can be bound to Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key1 = 'Hello';
      const value1_1 = true;
      const value1_2 = false;

      const key2 = 'World';
      const value2 = 4321;

      type stateType<T extends Serializable> = {
        [key1]: T | undefined;
        [key2]: number;
      };

      class TestClass<T extends Serializable> extends Entity<stateType<T>> {
        get [key1]() {
          return this.get(key1);
        }
        set [key1](value: T | undefined) {
          this.set(key1, value);
        }
        get [key2]() {
          return this.get(key2);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<TestClass<boolean>>();
        const method = methods.create(
          'method',
          (instance: TestClass<boolean>) => {
            resolve(instance);
          }
        );

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) =>
            <T extends Serializable>(value1: T) => {
              const state = stateBuilder.build({
                [key1]: value1,
                [key2]: value2,
              });
              return new TestClass(state);
            }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          method,
          futureMachine,
          createTest,
          promise,
        };
      }

      let futureId: FutureId<keyof stateType<boolean>>;

      {
        const { futureDatabase, method, createTest, futureMachine } =
          await createMethods();
        const { future, id } =
          futureMachine.withResolvers<keyof stateType<boolean>>();
        futureId = id;

        const instance = createTest<boolean>(value1_1);
        future.next(method.bindArgs(instance));

        instance[key1] = value1_2;

        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId, key2);

        const instance = await promise;

        assert.strictEqual(instance[key1], value1_2);
        assert.strictEqual(instance[key2], value2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can hold Futures across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key = 'hello';
      const value = 4321;

      type stateType = {
        [key]: Future<number>;
      };

      class TestClass extends Entity<stateType> {
        get value() {
          return this.get(key);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<TestClass>();
        const method = methods.create('method', (entity: TestClass) => {
          resolve(entity);
        });

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) => (value: Future<number>) => {
            const state = stateBuilder.build({
              [key]: value,
            });
            return new TestClass(state);
          }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          createTest,
          method,
          futureMachine,
          promise,
        };
      }

      let futureId: FutureId<void>;

      {
        const { futureDatabase, method, createTest, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const entity = createTest(futureMachine.resolve(value));

        future.next(method.bindArgs(entity));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const entity = await promise;
        const future = entity.value;

        assert.strictEqual(await future.getPromise(), value);
        await dbHolder.close(futureDatabase);
      }
    });

    test('always returns the same instance of a Method until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods } = createMethodMachine(futureDatabase);

      type stateType = { boundMethod: Method<() => void> };

      class TestClass extends Entity<stateType> {
        get boundMethod() {
          return this.get('boundMethod');
        }
      }

      type holderArg = TestClass;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const method = methods.create('method', (_num: number) => {});

      const createTest = methods.registerEntity(
        'test',
        TestClass,
        (stateBuilder: StateBuilder) => (value: Method<() => void>) => {
          const state = stateBuilder.build<stateType>({
            boundMethod: value,
          });
          return new TestClass(state);
        }
      );

      const futureMachine = methods.build();

      const { future, id } = futureMachine.withResolvers<void>();

      const boundMethod = method.bindArgs(1);
      const original = createTest(boundMethod);

      future.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.boundMethod, boundMethod);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a Method until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods } = createMethodMachine(futureDatabase);

      type stateType = { future: Future<number> };

      class TestClass extends Entity<stateType> {
        get future() {
          return this.get('future');
        }
      }

      type holderArg = TestClass;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const createTest = methods.registerEntity(
        'test',
        TestClass,
        (stateBuilder: StateBuilder) => (value: Future<number>) => {
          const state = stateBuilder.build<stateType>({
            future: value,
          });
          return new TestClass(state);
        }
      );

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const { future } = futureMachine.withResolvers<number>();
      const original = createTest(future);

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.future, future);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of an Entity until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods } = createMethodMachine(futureDatabase);

      type stateType = Record<string, never>;
      class TestClass extends Entity<stateType> {}
      const createTest = methods.registerEntity(
        'test',
        TestClass,
        (stateBuilder: StateBuilder) => () => {
          const state = stateBuilder.build<stateType>({});
          return new TestClass(state);
        }
      );

      type holderState = { test: TestClass };
      class Holder extends Entity<holderState> {
        get test() {
          return this.get('test');
        }
      }
      const createHolder = methods.registerEntity(
        'Holder',
        Holder,
        (stateBuilder: StateBuilder) => (test: TestClass) => {
          const state = stateBuilder.build<holderState>({ test });
          return new Holder(state);
        }
      );

      type holderArg = Holder;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const futureMachine = methods.build();

      const { future, id } = futureMachine.withResolvers<void>();

      const test = createTest();
      const original = createHolder(test);

      future.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.test, test);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a List until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type stateType = { value: List<number[]> };

      class TestClass extends Entity<stateType> {
        get value() {
          return this.get('value');
        }
      }

      type holderArg = TestClass;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const createTest = methods.registerEntity(
        'test',
        TestClass,
        (stateBuilder: StateBuilder) => (value: List<number[]>) => {
          const state = stateBuilder.build<stateType>({ value });
          return new TestClass(state);
        }
      );

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const list = containers.createList<number[]>();
      const original = createTest(list);

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.value, list);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a Struct until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type structType = { num: number };

      type stateType = { value: Struct<structType> };

      class TestClass extends Entity<stateType> {
        get value() {
          return this.get('value');
        }
      }

      type holderArg = TestClass;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const createTest = methods.registerEntity(
        'test',
        TestClass,
        (stateBuilder: StateBuilder) => (value: Struct<structType>) => {
          const state = stateBuilder.build<stateType>({ value });
          return new TestClass(state);
        }
      );

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const value = containers.createStruct<structType>({ num: 1 });
      const original = createTest(value);

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      assert.strictEqual(held.value, value);

      await dbHolder.close(futureDatabase);
    });

    test('always returns the same instance of a Dictionary until garbage collection', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type stateType = { value: Dictionary<number> };

      class TestClass extends Entity<stateType> {
        get value() {
          return this.get('value');
        }
      }

      type holderArg = TestClass;
      const { promise, resolve } = Promise.withResolvers<holderArg>();
      const holder = methods.create('holder', (arg: holderArg) => {
        resolve(arg);
      });

      const createTest = methods.registerEntity(
        'test',
        TestClass,
        (stateBuilder: StateBuilder) => (value: Dictionary<number>) => {
          const state = stateBuilder.build<stateType>({ value });
          return new TestClass(state);
        }
      );

      const futureMachine = methods.build();

      const { future: holdingFuture, id } = futureMachine.withResolvers<void>();

      const value = containers.createDictionary<number>();
      const original = createTest(value);

      holdingFuture.next(holder.bindArgs(original));

      futureMachine.resolveFutureById(id);

      const held = await promise;

      // LEFT OFF: This failed for some reason? The dictionaryDb is returning
      // undefined for the facade. It does this for both the simple and sqlite
      // databases.
      assert.strictEqual(held.value, value);

      await dbHolder.close(futureDatabase);
    });

    test('can hold Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key = 'hello';
      const value = 4321;

      type stateType = {
        [key]: Method<() => number>;
      };

      class TestClass extends Entity<stateType> {
        get value() {
          return this.get(key);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const thunk = methods.create('thunk', (num: number) => {
          return num;
        });

        const { promise, resolve } = Promise.withResolvers<TestClass>();
        const holder = methods.create('holder', (entity: TestClass) => {
          resolve(entity);
        });

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) => (value: Method<() => number>) => {
            const state = stateBuilder.build({
              [key]: value,
            });
            return new TestClass(state);
          }
        );

        const futureMachine = methods.build();

        return {
          futureDatabase,
          holder,
          thunk,
          createTest,
          futureMachine,
          promise,
        };
      }

      let futureId: FutureId<void>;

      {
        const { futureDatabase, holder, thunk, createTest, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const entity = createTest(thunk.bindArgs(value));

        future.next(holder.bindArgs(entity));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const entity = await promise;
        const method = entity.value;

        assert.strictEqual(method(), value);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be constructed with containers in its state across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key1 = 'Hello';
      const value1 = [441, 234, 81, 27, 8, 5678];

      const key2 = 'World';
      const value2 = 4321;

      type stateType = {
        [key1]: List<number[]>;
        [key2]: number;
      };

      class TestClass extends Entity<stateType> {
        get [key1]() {
          return this.get(key1);
        }
        get [key2]() {
          return this.get(key2);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<TestClass>();
        const method = methods.create('method', (instance: TestClass) => {
          resolve(instance);
        });

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) => (value1: List<number[]>) => {
            const state = stateBuilder.build({
              [key1]: value1,
              [key2]: value2,
            });
            return new TestClass(state);
          }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          method,
          futureMachine,
          createTest,
          promise,
        };
      }

      let futureId: FutureId<void>;

      {
        const {
          containers,
          futureDatabase,
          method,
          createTest,
          futureMachine,
        } = await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const instance = createTest(containers.createList(...value1));
        future.next(method.bindArgs(instance));

        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const instance = await promise;

        assert.deepStrictEqual([...instance[key1]], value1);
        assert.strictEqual(instance[key2], value2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in a Future returned by FutureMachine.resolve across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key1 = 'Hello';
      const value1_1 = true;
      const value1_2 = false;

      const key2 = 'World';
      const value2 = 4321;

      type stateType<T extends Serializable> = {
        [key1]: T | undefined;
        [key2]: number;
      };

      class TestClass<T extends Serializable> extends Entity<stateType<T>> {
        get [key1]() {
          return this.get(key1);
        }
        set [key1](value: T | undefined) {
          this.set(key1, value);
        }
        get [key2]() {
          return this.get(key2);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Future<TestClass<boolean>>>();
        const method = methods.create(
          'method',
          (dictionary: Future<TestClass<boolean>>) => {
            resolve(dictionary);
          }
        );

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) =>
            <T extends Serializable>(value1: T) => {
              const state = stateBuilder.build({
                [key1]: value1,
                [key2]: value2,
              });
              return new TestClass(state);
            }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          method,
          futureMachine,
          promise,
          createTest,
        };
      }

      let futureId: FutureId<void>;

      {
        const { futureDatabase, method, futureMachine, createTest } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const instance = createTest<boolean>(value1_1);
        instance[key1] = value1_2;

        future.next(method.bindArgs(futureMachine.resolve(instance)));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);
        const future: Future<TestClass<boolean>> = await promise;
        const instance = await future.getPromise();

        assert.strictEqual(instance[key1], value1_2);
        assert.strictEqual(instance[key2], value2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in an AggregateDB of FutureMachine.all across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key1 = 'Hello';
      const key2 = 'World';
      const value1_1 = 1234;
      const value1_2 = 4321;
      const value2_2 = 111;

      type stateType = {
        [key1]: number | undefined;
        [key2]: number;
      };

      class TestClass extends Entity<stateType> {
        get [key1]() {
          return this.get(key1);
        }
        set [key1](value: number | undefined) {
          this.set(key1, value);
        }
        get [key2]() {
          return this.get(key2);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<List<TestClass[]>>();
        const method = methods.create(
          'method',
          (dictionaries: List<TestClass[]>) => {
            resolve(dictionaries);
          }
        );

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) =>
            (value1: number | undefined, value2: number) => {
              const state = stateBuilder.build({
                [key1]: value1,
                [key2]: value2,
              });
              return new TestClass(state);
            }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          method,
          futureMachine,
          promise,
          createTest,
        };
      }

      let futureId1: FutureId<TestClass>;
      let futureId2: FutureId<TestClass>;

      {
        const { futureDatabase, method, futureMachine } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<TestClass>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<TestClass>();
        futureId2 = id2;
        futureMachine.all([future1, future2]).next(method);
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, createTest } =
          await createMethods();
        const instance2 = createTest(undefined, value2_2);

        futureMachine.resolveFutureById(futureId2, instance2);

        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise, createTest } =
          await createMethods();

        const instance1 = createTest(undefined, value1_2);

        futureMachine.resolveFutureById(futureId1, instance1);

        instance1[key1] = value1_1;

        const instances: List<TestClass[]> = await promise;

        assert.deepStrictEqual(instances.at(0)[key1], value1_1);
        assert.deepStrictEqual(instances.at(0)[key2], value1_2);
        assert.deepStrictEqual(instances.at(1)[key1], undefined);
        assert.deepStrictEqual(instances.at(1)[key2], value2_2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in an AggregateDB of FutureMachine.allSettled across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key1 = 'Hello';
      const key2 = 'World';
      const value1_1 = 1234;
      const value1_2 = 4321;
      const value2_2 = 111;

      type stateType = {
        [key1]: number | undefined;
        [key2]: number;
      };

      class TestClass extends Entity<stateType> {
        get [key1]() {
          return this.get(key1);
        }
        set [key1](value: number | undefined) {
          this.set(key1, value);
        }
        get [key2]() {
          return this.get(key2);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<List<FutureSettledResult<TestClass>[]>>();
        const method = methods.create(
          'method',
          (dictionaries: List<FutureSettledResult<TestClass>[]>) => {
            resolve(dictionaries);
          }
        );

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) =>
            (value1: number | undefined, value2: number) => {
              const state = stateBuilder.build({
                [key1]: value1,
                [key2]: value2,
              });
              return new TestClass(state);
            }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          method,
          futureMachine,
          promise,
          createTest,
        };
      }

      let futureId1: FutureId<TestClass>;
      let futureId2: FutureId<TestClass>;

      {
        const { futureDatabase, method, futureMachine } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<TestClass>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<TestClass>();
        futureId2 = id2;
        futureMachine.allSettled([future1, future2]).next(method);
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, createTest } =
          await createMethods();
        const instance2 = createTest(undefined, value2_2);

        futureMachine.resolveFutureById(futureId2, instance2);

        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise, createTest } =
          await createMethods();

        const instance1 = createTest(undefined, value1_2);

        futureMachine.resolveFutureById(futureId1, instance1);

        instance1[key1] = value1_1;

        const instances: List<FutureSettledResult<TestClass>[]> = await promise;

        assert.deepStrictEqual(instances.at(0).status, 'fulfilled');
        const result0 = instances.at(0) as FutureFulfilledResult<TestClass>;
        assert.deepStrictEqual(result0.value![key1], value1_1);
        assert.deepStrictEqual(result0.value![key2], value1_2);
        assert.deepStrictEqual(instances.at(1).status, 'fulfilled');
        const result1 = instances.at(1) as FutureFulfilledResult<TestClass>;
        assert.deepStrictEqual(result1.value![key1], undefined);
        assert.deepStrictEqual(result1.value![key2], value2_2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be held in an AggregateDB of FutureMachine.any across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key1 = 'Hello';
      const key2 = 'World';
      const value1_1 = 1234;
      const value1_2 = 4321;
      const value2_2 = 111;

      type stateType = {
        [key1]: number | undefined;
        [key2]: number;
      };

      class TestClass extends Entity<stateType> {
        get [key1]() {
          return this.get(key1);
        }
        set [key1](value: number | undefined) {
          this.set(key1, value);
        }
        get [key2]() {
          return this.get(key2);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<AggregateException>();
        const method = methods.create(
          'method',
          (exception: AggregateException) => {
            resolve(exception);
          }
        );

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) =>
            (value1: number | undefined, value2: number) => {
              const state = stateBuilder.build({
                [key1]: value1,
                [key2]: value2,
              });
              return new TestClass(state);
            }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          method,
          futureMachine,
          promise,
          createTest,
        };
      }

      let futureId1: FutureId<TestClass>;
      let futureId2: FutureId<TestClass>;

      {
        const { futureDatabase, method, futureMachine } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<TestClass>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<TestClass>();
        futureId2 = id2;
        futureMachine.any([future1, future2]).catch(method);
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, createTest } =
          await createMethods();
        const instance2 = createTest(undefined, value2_2);

        futureMachine.rejectFutureById(futureId2, instance2);

        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise, createTest } =
          await createMethods();

        const instance1 = createTest(undefined, value1_2);

        futureMachine.rejectFutureById(futureId1, instance1);

        instance1[key1] = value1_1;

        const exception: AggregateException = await promise;

        const error1 = exception.errors.at(0) as TestClass;
        const error2 = exception.errors.at(1) as TestClass;

        assert.deepStrictEqual(error1[key1], value1_1);
        assert.deepStrictEqual(error1[key2], value1_2);
        assert.deepStrictEqual(error2[key1], undefined);
        assert.deepStrictEqual(error2[key2], value2_2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('constructor can be bound to Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key1 = 'Hello';
      const value1 = 'Hello world';

      const key2 = 'World';
      const value2 = 4321;

      type stateType<T extends Serializable> = {
        [key1]: T | undefined;
        [key2]: number;
      };

      class TestClass<T extends Serializable> extends Entity<stateType<T>> {
        get [key1]() {
          return this.get(key1);
        }
        set [key1](value: T | undefined) {
          this.set(key1, value);
        }
        get [key2]() {
          return this.get(key2);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<
            Method<<T extends Serializable>(value1: T) => TestClass<T>>
          >();
        const method = methods.create(
          'method',
          (
            constructor: Method<
              <T extends Serializable>(value1: T) => TestClass<T>
            >
          ) => {
            resolve(constructor);
          }
        );

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) =>
            <T extends Serializable>(value1: T) => {
              const state = stateBuilder.build({
                [key1]: value1,
                [key2]: value2,
              });
              return new TestClass(state);
            }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          method,
          futureMachine,
          createTest,
          promise,
        };
      }

      let futureId: FutureId<void>;

      {
        const { futureDatabase, method, createTest, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        future.next(method.bindArgs(createTest));

        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const constructor = await promise;
        const instance = constructor(value1);

        assert.strictEqual(instance[key1], value1);
        assert.strictEqual(instance[key2], value2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('can be updated across multiple Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const key1: string = 'Hello';
      const value1_1 = true;
      const value1_2 = false;

      const key2 = 'World';
      const value2 = 4321;

      type stateType<T extends Serializable> = {
        [key1]: T | undefined;
        [key2]: number;
      };

      class TestClass<T extends Serializable> extends Entity<stateType<T>> {
        get [key1]() {
          return this.get(key1);
        }
        set [key1](value: T | undefined) {
          this.set(key1, value);
        }

        get [key2]() {
          return this.get(key2);
        }
        set [key2](value: number) {
          this.set(key2, value);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<
          number | boolean | undefined
        >();
        const method = methods.create(
          'method',
          (instance: TestClass<boolean>, key: keyof stateType<boolean>) => {
            resolve(instance[key]);
          }
        );

        const updateMethod = methods.create(
          'updateMethod',
          <K extends keyof TestClass<boolean>>(
            instance: TestClass<boolean>,
            key: K,
            value: TestClass<boolean>[K]
          ) => {
            instance[key] = value;
          }
        );

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) =>
            <T extends Serializable>(value1: T) => {
              const state = stateBuilder.build({
                [key1]: value1,
                [key2]: value2,
              });
              return new TestClass(state);
            }
        );

        const futureMachine = methods.build();

        return {
          futureDatabase,
          method,
          createTest,
          updateMethod,
          futureMachine,
          promise,
        };
      }

      let futureId1: FutureId<keyof stateType<boolean>>;
      let futureId2: FutureId<boolean>;

      {
        const {
          futureDatabase,
          method,
          createTest,
          updateMethod,
          futureMachine,
        } = await createMethods();
        const { future: future1, id: id1 } =
          futureMachine.withResolvers<keyof stateType<boolean>>();
        futureId1 = id1;
        const { future: future2, id: id2 } =
          futureMachine.withResolvers<boolean>();
        futureId2 = id2;

        const instance = createTest(value1_1);

        future1.next(method.bindArgs(instance));
        future2.next(updateMethod.bindArgs(instance, key1));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine } = await createMethods();
        futureMachine.resolveFutureById(futureId2, value1_2);
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId1, key1);

        assert.strictEqual(await promise, value1_2);
        await dbHolder.close(futureDatabase);
      }
    });

    test('if a bound Entity refers to a Entity that no longer exists, the Method rejects when called', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key1 = 'Hello';
      const value1_1 = true;

      const key2 = 'World';
      const value2 = 4321;

      type stateType<T extends Serializable> = {
        [key1]: T | undefined;
        [key2]: number;
      };

      class TestClass<T extends Serializable> extends Entity<stateType<T>> {
        get [key1]() {
          return this.get(key1);
        }
        set [key1](value: T | undefined) {
          this.set(key1, value);
        }
        get [key2]() {
          return this.get(key2);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<Exception>();
        const method = methods.create(
          'method',
          (_instance: TestClass<boolean>) => {}
        );
        const catcher = methods.create('catcher', (exception: Exception) => {
          resolve(exception);
        });

        return {
          containers,
          futureDatabase,
          methods,
          method,
          catcher,
          promise,
        };
      }

      let futureId: FutureId<void>;

      {
        const { futureDatabase, methods, method, catcher } =
          await createMethods();

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) =>
            <T extends Serializable>(value1: T) => {
              const state = stateBuilder.build({
                [key1]: value1,
                [key2]: value2,
              });
              return new TestClass(state);
            }
        );

        const futureMachine = methods.build();

        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const instance = createTest(value1_1);
        future.next(method.bindArgs(instance)).catch(catcher);

        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, methods, promise } = await createMethods();
        const futureMachine = methods.build();
        futureMachine.resolveFutureById(futureId);

        assert.ok((await promise) instanceof Exception);

        await dbHolder.close(futureDatabase);
      }
    });

    test('if a bound Method has a bound Entity that no longer exists, the Method rejects when called', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      const key1 = 'Hello';
      const value1_1 = true;

      const key2 = 'World';
      const value2 = 4321;

      type stateType<T extends Serializable> = {
        [key1]: T | undefined;
        [key2]: number;
      };

      class TestClass<T extends Serializable> extends Entity<stateType<T>> {
        get [key1]() {
          return this.get(key1);
        }
        set [key1](value: T | undefined) {
          this.set(key1, value);
        }
        get [key2]() {
          return this.get(key2);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<Method<() => void>>();
        const boundMethod = methods.create(
          'boundMethod',
          (_instance: TestClass<boolean>) => {}
        );
        const method = methods.create(
          'method',
          (boundMethod: Method<() => void>) => {
            resolve(boundMethod);
          }
        );

        return {
          containers,
          futureDatabase,
          methods,
          method,
          boundMethod,
          promise,
        };
      }

      let futureId: FutureId<void>;

      {
        const { futureDatabase, methods, method, boundMethod } =
          await createMethods();

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) =>
            <T extends Serializable>(value1: T) => {
              const state = stateBuilder.build({
                [key1]: value1,
                [key2]: value2,
              });
              return new TestClass(state);
            }
        );

        const futureMachine = methods.build();

        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const instance = createTest(value1_1);
        future.next(method.bindArgs(boundMethod.bindArgs(instance)));

        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, methods, promise } = await createMethods();
        const futureMachine = methods.build();
        futureMachine.resolveFutureById(futureId);

        const boundMethod = await promise;

        assert.throws(boundMethod);

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
        [dictEntryKey]: Dictionary<number> | undefined;
        [listEntryKey]: List<string[]> | undefined;
        [structEntryKey]: Struct<structType> | undefined;
        [entityEntryKey]: TestEntryClass<number> | undefined;
      };

      type entryStateType<T> = {
        [entityKey1]: T | undefined;
        [entityKey2]: number;
      };

      const dictEntryKey = 'Dict';
      const dictKey = 'World';
      const dictValue = 1234;

      const listEntryKey = 'List';
      const listItem0 = 'hello';
      const listItem1 = 'world';

      const structEntryKey = 'Struct';

      const structValue1 = true;
      const structValue2 = 123;

      const entityEntryKey = 'Entity';
      const entityKey1 = 'Hello';
      const entityValue1 = 1234;

      const entityKey2 = 'World';
      const entityValue2 = 4321;

      class TestClass extends Entity<stateType> {
        get [dictEntryKey](): Dictionary<number> | undefined {
          return this.get(dictEntryKey);
        }
        set [dictEntryKey](value: Dictionary<number>) {
          this.set(dictEntryKey, value);
        }
        get [listEntryKey](): List<string[]> | undefined {
          return this.get(listEntryKey);
        }
        set [listEntryKey](value: List<string[]>) {
          this.set(listEntryKey, value);
        }
        get [structEntryKey](): Struct<structType> | undefined {
          return this.get(structEntryKey);
        }
        set [structEntryKey](value: Struct<structType>) {
          this.set(structEntryKey, value);
        }
        get [entityEntryKey](): TestEntryClass<number> | undefined {
          return this.get(entityEntryKey);
        }
        set [entityEntryKey](value: TestEntryClass<number>) {
          this.set(entityEntryKey, value);
        }
      }

      class TestEntryClass<T extends Serializable> extends Entity<
        entryStateType<T>
      > {
        get [entityKey1]() {
          return this.get(entityKey1);
        }
        get [entityKey2]() {
          return this.get(entityKey2);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<TestClass>();
        const method = methods.create('method', (entity: TestClass) => {
          resolve(entity);
        });

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) => () => {
            return new TestClass(
              stateBuilder.build({
                [dictEntryKey]: undefined,
                [listEntryKey]: undefined,
                [structEntryKey]: undefined,
                [entityEntryKey]: undefined,
              })
            );
          }
        );
        const createTestEntry = methods.registerEntity(
          'testEntry',
          TestEntryClass,
          (stateBuilder: StateBuilder) =>
            <T extends Serializable>(value1: T) => {
              const state = stateBuilder.build({
                [entityKey1]: value1,
                [entityKey2]: entityValue2,
              });
              return new TestEntryClass(state);
            }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          futureMachine,
          method,
          createTest,
          createTestEntry,
          promise,
        };
      }

      let futureId: FutureId<string>;

      {
        const {
          containers,
          futureDatabase,
          futureMachine,
          method,
          createTest,
          createTestEntry,
        } = await createMethods();
        const { future, id } = futureMachine.withResolvers<string>();
        futureId = id;

        const entity = createTest();

        const dictionaryEntry = containers.createDictionary<number>();

        const listEntry = containers.createList<string[]>(listItem0, listItem1);

        const structEntry = containers.createStruct<structType>({
          A: undefined,
          B: structValue2,
        });

        const entityEntry = createTestEntry(entityValue1);

        entity[dictEntryKey] = dictionaryEntry;
        entity[listEntryKey] = listEntry;
        entity[structEntryKey] = structEntry;
        entity[entityEntryKey] = entityEntry;

        dictionaryEntry.set(dictKey, dictValue);
        structEntry.A = structValue1;

        future.next(method.bindArgs(entity));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId, dictKey);

        const entity = await promise;

        const dictionaryEntry = entity[dictEntryKey] as
          | Dictionary<number>
          | undefined;

        assert.notStrictEqual(dictionaryEntry, undefined);
        assert.strictEqual(dictionaryEntry!.get(dictKey), dictValue);

        const listEntry = entity[listEntryKey] as List<string[]> | undefined;

        assert.notStrictEqual(listEntry, undefined);
        assert.strictEqual(listEntry!.at(0), listItem0);
        assert.strictEqual(listEntry!.at(1), listItem1);

        const structEntry = entity[structEntryKey] as
          | Struct<structType>
          | undefined;

        assert.notStrictEqual(structEntry, undefined);
        assert.strictEqual(structEntry!.A, structValue1);
        assert.strictEqual(structEntry!.B, structValue2);

        const entityEntry = entity[entityEntryKey] as
          | TestEntryClass<number>
          | undefined;

        assert.notStrictEqual(entityEntry, undefined);
        assert.strictEqual(entityEntry![entityKey1], entityValue1);
        assert.strictEqual(entityEntry![entityKey2], entityValue2);

        await dbHolder.close(futureDatabase);
      }
    });

    test('can have itself as an entry', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      type stateType = {
        self: TestClass | undefined;
      };

      class TestClass extends Entity<stateType> {
        get self(): TestClass {
          return this.get('self')!;
        }
        set self(value: TestClass) {
          this.set('self', value);
        }
      }

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, containers } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<TestClass>();
        const method = methods.create('method', (entity: TestClass) => {
          resolve(entity);
        });

        const createTest = methods.registerEntity(
          'test',
          TestClass,
          (stateBuilder: StateBuilder) => () => {
            const state = stateBuilder.build({
              self: undefined,
            });
            const testClass = new TestClass(state);
            testClass.self = testClass;
            return testClass;
          }
        );

        const futureMachine = methods.build();

        return {
          containers,
          futureDatabase,
          futureMachine,
          createTest,
          method,
          promise,
        };
      }

      let futureId: FutureId<void>;

      {
        const { futureDatabase, futureMachine, createTest, method } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        const entity = createTest();

        future.next(method.bindArgs(entity));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const entity = await promise;

        const entityEntry = entity.self;
        assert.notStrictEqual(entityEntry, undefined);
        assert.strictEqual(entity, entityEntry);

        await dbHolder.close(futureDatabase);
      }
    });
  });
};
