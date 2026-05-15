import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import type {
  Dictionary,
  Future,
  FutureId,
  List,
  Method,
  Serializable,
  Struct,
} from '@futuremachine/core';
import {
  createFutureMachine,
  FutureState,
  GetFutureDatabase,
} from '@futuremachine/core';
import { SQLFutureDatabase } from '../src/index.js';
import { ValueType } from '../src/sql_database_intf.js';
import {
  cleanupDbFiles,
  forceGarbageCollection,
  randomDatabasePath,
} from './test_helpers.js';

describe('SQLFutureDatabase', () => {
  describe('future ids', () => {
    test('Can pass an invalid future id', async (t) => {
      const dbPath = randomDatabasePath();
      t.after(() => {
        cleanupDbFiles(dbPath);
      });
      const futureDatabase = new SQLFutureDatabase(dbPath);
      const { methods } = createFutureMachine(futureDatabase);
      const futures = methods.build();

      futures.resolveFutureById('future-1234' as FutureId<void>);

      await futureDatabase.close();
    });
  });
  describe('flush', () => {
    test("reactions aren't written to disk until flush is called", async (t) => {
      const dbPath = randomDatabasePath();
      t.after(() => {
        cleanupDbFiles(dbPath);
      });
      const futureDatabase = new SQLFutureDatabase(dbPath);
      const { methods } = createFutureMachine(futureDatabase);

      const method = methods.create('method', () => {});

      const futures = methods.build();

      const { future } = futures.withResolvers<void>();

      future.next(method);

      const futureDatabaseImpl = futureDatabase[GetFutureDatabase]();

      assert.strictEqual(futureDatabaseImpl.getReactionsCountForTesting(), 0);

      // Spin the loop a few times to make sure.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      assert.strictEqual(futureDatabaseImpl.getReactionsCountForTesting(), 0);

      await futureDatabase.flush();
      // Should be a reaction for fulfill and reject.
      assert.strictEqual(futureDatabaseImpl.getReactionsCountForTesting(), 2);

      await futureDatabase.close();
    });

    test("future state changes aren't written to disk until flush is called", async (t) => {
      const dbPath = randomDatabasePath();
      t.after(() => {
        cleanupDbFiles(dbPath);
      });
      const futureDatabase = new SQLFutureDatabase(dbPath);
      const futureDatabaseImpl = futureDatabase[GetFutureDatabase]();
      const { methods } = createFutureMachine(futureDatabase);
      const futures = methods.build();

      const { resolve, id } = futures.withResolvers<number>();

      assert.deepStrictEqual(
        futureDatabaseImpl.getFutureStateForTesting(id),
        undefined
      );

      await futureDatabase.flush();

      const result = 3;
      resolve(result);

      assert.deepStrictEqual(futureDatabaseImpl.getFutureStateForTesting(id), {
        state: FutureState.Pending,
        root: true,
        alreadySettled: false,
        valueType: undefined,
        value: undefined,
      });

      // Spin the loop a few times to make sure.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      assert.deepStrictEqual(futureDatabaseImpl.getFutureStateForTesting(id), {
        state: FutureState.Pending,
        root: true,
        alreadySettled: false,
        valueType: undefined,
        value: undefined,
      });

      await futureDatabase.flush();

      assert.deepStrictEqual(futureDatabaseImpl.getFutureStateForTesting(id), {
        state: FutureState.Fulfilled,
        root: false,
        alreadySettled: true,
        valueType: ValueType.Number,
        value: result.toString(),
      });

      await futureDatabase.close();
    });

    // TODO: Currently unrelated to flush.
    test("futures aren't written to disk until needed", async (t) => {
      const dbPath = randomDatabasePath();
      t.after(() => {
        cleanupDbFiles(dbPath);
      });
      const futureDatabase = new SQLFutureDatabase(dbPath);
      const { methods } = createFutureMachine(futureDatabase);

      const method = methods.create('method', (_future: Future<number>) => {});

      const futures = methods.build();

      const rejectedFuture = futures.reject<number>(123);

      const futureDatabaseImpl = futureDatabase[GetFutureDatabase]();

      assert.strictEqual(futureDatabaseImpl.getFuturesCountForTesting(), 0);

      // Spin the loop a few times to make sure.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      assert.strictEqual(futureDatabaseImpl.getFuturesCountForTesting(), 0);

      // Binding it to a method won't write it to the database either.
      const boundMethod = method.bindArgs(rejectedFuture);
      assert.strictEqual(futureDatabaseImpl.getFuturesCountForTesting(), 0);

      // Even flushing shouldn't write a resolved future if it's not referenced
      // by anything.
      await futureDatabase.flush();
      assert.strictEqual(futureDatabaseImpl.getFuturesCountForTesting(), 0);

      const { future } = futures.withResolvers();

      // Creating an unresolved future won't write to the disk until a flush().
      assert.strictEqual(futureDatabaseImpl.getFuturesCountForTesting(), 0);
      await futureDatabase.flush();
      assert.strictEqual(futureDatabaseImpl.getFuturesCountForTesting(), 1);

      // Once a Future that is written to the disk references is it directly or
      // indirectly it should be written to disk on next flush.
      future.next(boundMethod);
      assert.strictEqual(futureDatabaseImpl.getFuturesCountForTesting(), 1);

      // There's three here: one for `future`, one for `rejectedFuture`, and one
      // for the future returned by `next`.
      await futureDatabase.flush();
      assert.strictEqual(futureDatabaseImpl.getFuturesCountForTesting(), 3);

      await futureDatabase.close();
    });
  });
  describe('garbage collection', () => {
    test('in memory objects that get garbage collected are rewritten when needed', async (t) => {
      const dbPath = randomDatabasePath();
      t.after(() => {
        cleanupDbFiles(dbPath);
      });

      async function createMethods() {
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const { methods, containers } = createFutureMachine(futureDatabase);
        const { promise, resolve } = Promise.withResolvers<List<number[]>>();
        const method = methods.create('method', (list: List<number[]>) => {
          resolve(list);
        });
        return {
          futureDatabase,
          futures: methods.build(),
          containers,
          method,
          promise,
        };
      }

      const values = [76, 33, 2, 49, 90];

      let futureId: FutureId<void>;

      {
        const { futureDatabase, futures, containers, method } =
          await createMethods();

        const list = containers.list.create(...values);
        const { future: f1, resolve: r1 } = futures.withResolvers<void>();

        f1.next(method.bindArgs(list));

        await futureDatabase.flush();

        r1();

        await futureDatabase.gc();

        const { future: f2, id } = futures.withResolvers<void>();
        futureId = id;

        f2.next(method.bindArgs(list));

        await futureDatabase.close();
      }

      {
        const { futureDatabase, futures, promise } = await createMethods();

        futures.resolveFutureById(futureId);

        assert.deepStrictEqual([...(await promise)], values);

        await futureDatabase.close();
      }
    });

    test("in memory objects keep the same id after garbage collection if they weren't garbage collected", async (t) => {
      const dbPath = randomDatabasePath();
      t.after(() => {
        cleanupDbFiles(dbPath);
      });

      async function createMethods() {
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const { methods, containers } = createFutureMachine(futureDatabase);
        const { promise: p1, resolve: r1 } =
          Promise.withResolvers<List<number[]>>();
        const method1 = methods.create('method1', (list: List<number[]>) => {
          r1(list);
        });
        const { promise: p2, resolve: r2 } =
          Promise.withResolvers<List<number[]>>();
        const method2 = methods.create('method2', (list: List<number[]>) => {
          r2(list);
        });
        return {
          futureDatabase,
          futures: methods.build(),
          containers,
          method1,
          method2,
          p1,
          p2,
        };
      }

      const values = [76, 33, 2, 49, 90];

      let futureId1: FutureId<void>;
      let futureId2: FutureId<void>;

      {
        const { futureDatabase, futures, containers, method1, method2 } =
          await createMethods();

        const list = containers.list.create(...values);
        const { future: f1, id: id1 } = futures.withResolvers<void>();
        futureId1 = id1;

        f1.next(method1.bindArgs(list));

        await futureDatabase.flush();

        await futureDatabase.gc();

        const { future: f2, id: id2 } = futures.withResolvers<void>();
        futureId2 = id2;

        f2.next(method2.bindArgs(list));

        await futureDatabase.close();
      }

      {
        const { futureDatabase, futures, p1, p2 } = await createMethods();

        futures.resolveFutureById(futureId1);

        const v1 = await p1;

        assert.deepStrictEqual([...v1], values);

        v1.set([0], 0);

        futures.resolveFutureById(futureId2);

        const v2 = await p2;
        values[0] = 0;

        assert.deepStrictEqual([...v2], values);

        await futureDatabase.close();
      }
    });

    test('in memory methods that get garbage collected are rewritten when needed', async (t) => {
      const dbPath = randomDatabasePath();
      t.after(() => {
        cleanupDbFiles(dbPath);
      });

      async function createMethods() {
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const { methods } = createFutureMachine(futureDatabase);
        const { promise, resolve } = Promise.withResolvers<number>();
        const method = methods.create('method', (value: number) => {
          resolve(value);
        });
        return {
          futureDatabase,
          futures: methods.build(),
          method,
          promise,
        };
      }

      const value = 12;

      let futureId: FutureId<void>;

      {
        const { futureDatabase, futures, method } = await createMethods();

        const { future: f1, resolve: r1 } = futures.withResolvers<void>();

        const boundMethod = method.bindArgs(value);

        f1.next(boundMethod);

        await futureDatabase.flush();

        r1();

        await futureDatabase.gc();

        const { future: f2, id } = futures.withResolvers<void>();
        futureId = id;

        f2.next(boundMethod);

        await futureDatabase.close();
      }

      {
        const { futureDatabase, futures, promise } = await createMethods();

        futures.resolveFutureById(futureId);

        assert.deepStrictEqual(await promise, value);

        await futureDatabase.close();
      }
    });

    test("in memory methods keep the same id after garbage collection if they weren't garbage collected", async (t) => {
      const dbPath = randomDatabasePath();
      t.after(() => {
        cleanupDbFiles(dbPath);
      });

      async function createMethods() {
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const { methods } = createFutureMachine(futureDatabase);
        const { promise, resolve } = Promise.withResolvers<number>();
        const method = methods.create('method', (value: number) => {
          resolve(value);
        });
        return {
          futureDatabase,
          futures: methods.build(),
          method,
          promise,
        };
      }

      const value = 12;

      {
        const { futureDatabase, futures, method } = await createMethods();

        const { future: f1 } = futures.withResolvers<void>();

        const boundMethod = method.bindArgs(value);

        f1.next(boundMethod);

        await futureDatabase.flush();

        await futureDatabase.gc();

        const { future: f2 } = futures.withResolvers<void>();

        f2.next(boundMethod);

        const impl = futureDatabase[GetFutureDatabase]();

        await futureDatabase.flush();

        // We can only prove that a method doesn't have two ids is through
        // testing methods since a bounded method is immutable.
        assert.strictEqual(impl.getMethodsCountForTesting(), 1);

        await futureDatabase.close();
      }
    });

    test('in memory futures that get garbage collected are rewritten when needed', async (t) => {
      const dbPath = randomDatabasePath();
      t.after(() => {
        cleanupDbFiles(dbPath);
      });

      async function createMethods() {
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const { methods } = createFutureMachine(futureDatabase);
        const { promise, resolve } = Promise.withResolvers<Future<number>>();
        const method = methods.create('method', (future: Future<number>) => {
          resolve(future);
        });
        return {
          futureDatabase,
          futures: methods.build(),
          method,
          promise,
        };
      }

      const value = 12;

      let futureId: FutureId<void>;

      {
        const { futureDatabase, futures, method } = await createMethods();

        const { future: f1, resolve: r1 } = futures.withResolvers<void>();

        const boundFuture = futures.resolve<number>(value);

        f1.next(method.bindArgs(boundFuture));

        await futureDatabase.flush();

        r1();

        await futureDatabase.gc();

        const { future: f2, id } = futures.withResolvers<void>();
        futureId = id;

        f2.next(method.bindArgs(boundFuture));

        await futureDatabase.close();
      }

      {
        const { futureDatabase, futures, promise } = await createMethods();

        futures.resolveFutureById(futureId);

        assert.deepStrictEqual(await (await promise).getPromise(), value);

        await futureDatabase.close();
      }
    });

    test("in memory futures keep the same id after garbage collection if they weren't garbage collected", async (t) => {
      const dbPath = randomDatabasePath();
      t.after(() => {
        cleanupDbFiles(dbPath);
      });

      async function createMethods() {
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const { methods } = createFutureMachine(futureDatabase);
        const { promise, resolve } = Promise.withResolvers<Future<number>>();
        const method = methods.create('method', (future: Future<number>) => {
          resolve(future);
        });
        return {
          futureDatabase,
          futures: methods.build(),
          method,
          promise,
        };
      }

      const value = 12;

      let futureId: FutureId<void>;
      let boundFutureId: FutureId<number>;

      {
        const { futureDatabase, futures, method } = await createMethods();

        const { future: f1, resolve: r1 } = futures.withResolvers<void>();

        const { future: boundFuture, id: boundId } =
          futures.withResolvers<number>();
        boundFutureId = boundId;

        f1.next(method.bindArgs(boundFuture));

        await futureDatabase.flush();

        r1();

        await futureDatabase.gc();

        const { future: f2, id } = futures.withResolvers<void>();
        futureId = id;

        f2.next(method.bindArgs(boundFuture));

        await futureDatabase.close();
      }

      {
        const { futureDatabase, futures, promise } = await createMethods();

        futures.resolveFutureById(futureId);
        futures.resolveFutureById(boundFutureId, value);

        assert.deepStrictEqual(await (await promise).getPromise(), value);

        await futureDatabase.close();
      }
    });
  });

  describe('Weak cache', () => {
    describe('object', () => {
      test('Objects are not in the objectCache at creation', async (t) => {
        const dbPath = randomDatabasePath();
        t.after(() => {
          cleanupDbFiles(dbPath);
        });
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const impl = futureDatabase[GetFutureDatabase]();

        const { methods, containers } = createFutureMachine(futureDatabase);
        methods.build();

        containers.dictionary.create();
        assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 0);
      });

      test('Objects are added to cache after flush', async (t) => {
        const dbPath = randomDatabasePath();
        t.after(() => {
          cleanupDbFiles(dbPath);
        });
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const impl = futureDatabase[GetFutureDatabase]();

        const { methods, containers } = createFutureMachine(futureDatabase);

        const { promise, resolve: rP } =
          Promise.withResolvers<Dictionary<Serializable>>();
        const method = methods.create(
          'method',
          (obj: Dictionary<Serializable>) => {
            rP(obj);
          }
        );

        const futures = methods.build();

        const obj = containers.dictionary.create();
        assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 0);

        const { future, resolve: rF } = futures.withResolvers<void>();
        future.next(method.bindArgs(obj));
        assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 0);

        await futureDatabase.flush();
        assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 1);

        rF();
        const objFromCache = await promise;

        obj.set('key', 1);
        assert.strictEqual(objFromCache.get('key'), 1);
      });

      test('When nothing references them, Objects are removed from cache after garbage collection', async (t) => {
        const dbPath = randomDatabasePath();
        t.after(() => {
          cleanupDbFiles(dbPath);
        });
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const impl = futureDatabase[GetFutureDatabase]();

        const { methods, containers } = createFutureMachine(futureDatabase);

        const resolvers = Promise.withResolvers<{ dict: Dictionary<number> }>();
        const rP = resolvers.resolve;
        const promise: Promise<{ dict: Dictionary<number> | undefined }> =
          resolvers.promise;
        const method = methods.create('method', (dict: Dictionary<number>) => {
          rP({ dict });
        });

        const futures = methods.build();
        let futureId: FutureId<void>;

        await (async () => {
          const obj = containers.dictionary.create<number>();
          obj.set('key1', 2);
          assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 0);

          const { future, id } = futures.withResolvers<void>();
          futureId = id;

          future.next(method.bindArgs(obj));
          assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 0);

          await futureDatabase.flush();
          assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 1);
        })();

        await (async () => {
          assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 1);

          futures.resolveFutureById(futureId!);

          const obj = await promise;
          const { dict } = obj;
          obj.dict = undefined;
          assert.strictEqual(dict!.get('key1'), 2);
          assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 1);
        })();

        await forceGarbageCollection();
        assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 0);
      });

      test('Modified objects that have been written to disk remain in cache until flushed', async (t) => {
        const dbPath = randomDatabasePath();
        t.after(() => {
          cleanupDbFiles(dbPath);
        });
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const impl = futureDatabase[GetFutureDatabase]();

        const { methods, containers } = createFutureMachine(futureDatabase);

        type holder = Dictionary<number>;
        let rP: ((value: holder | PromiseLike<holder>) => void) | undefined;
        let promise: Promise<holder> | undefined;
        function updateResolvers() {
          const resolvers = Promise.withResolvers<holder>();
          rP = resolvers.resolve;
          promise = resolvers.promise;
        }
        updateResolvers();
        const method = methods.create('method', (dict: Dictionary<number>) => {
          if (rP === undefined) {
            throw new Error('Need to call updateResolvers');
          }
          rP(dict);
          rP = undefined;
          promise = undefined;
        });

        const futures = methods.build();
        let futureId: FutureId<void>;

        await (async () => {
          const obj = containers.dictionary.create<number>();
          obj.set('key1', 2);
          assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 0);

          const { future: f1, resolve: rF } = futures.withResolvers<void>();

          const { future: f2, id } = futures.withResolvers<void>();
          futureId = id;

          const boundMethod = method.bindArgs(obj);

          f1.next(boundMethod);
          f2.next(boundMethod);
          assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 0);

          await futureDatabase.flush();
          assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 1);

          obj.set('key1', 5);

          rF();
          const objFromCache = await promise;

          assert.strictEqual(objFromCache?.get('key1'), 5);
          updateResolvers();
        })();

        await forceGarbageCollection();
        assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 1);

        await (async () => {
          futures.resolveFutureById(futureId!);
          const objFromCache = await promise;

          assert.strictEqual(objFromCache?.get('key1'), 5);
          updateResolvers();
        })();

        await futureDatabase.flush();

        await forceGarbageCollection();
        assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 0);
      });
    });

    describe('method', () => {
      test('methods are not in the objectCache at creation', async (t) => {
        const dbPath = randomDatabasePath();
        t.after(() => {
          cleanupDbFiles(dbPath);
        });
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const impl = futureDatabase[GetFutureDatabase]();

        const { methods } = createFutureMachine(futureDatabase);
        methods.create('method', () => {});
        assert.strictEqual(impl.getMethodDbCacheSizeForTesting(), 0);
      });

      test('methods are added to the cache on flush', async (t) => {
        const dbPath = randomDatabasePath();
        t.after(() => {
          cleanupDbFiles(dbPath);
        });
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const impl = futureDatabase[GetFutureDatabase]();

        const { methods } = createFutureMachine(futureDatabase);
        const method = methods.create('method', () => {});
        assert.strictEqual(impl.getMethodDbCacheSizeForTesting(), 0);

        const futures = methods.build();

        const { future } = futures.withResolvers<void>();

        future.next(method);

        await futureDatabase.flush();
        assert.strictEqual(impl.getMethodDbCacheSizeForTesting(), 1);
      });

      test('methods are retrieved from the cache', async (t) => {
        const dbPath = randomDatabasePath();
        t.after(() => {
          cleanupDbFiles(dbPath);
        });
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const impl = futureDatabase[GetFutureDatabase]();

        const { methods } = createFutureMachine(futureDatabase);
        const method = methods.create('method', () => {});
        assert.strictEqual(impl.getMethodDbCacheSizeForTesting(), 0);

        const futures = methods.build();

        let futureId: FutureId<void>;
        (() => {
          const { future, id } = futures.withResolvers<void>();
          futureId = id;

          future.next(method);
          assert.strictEqual(impl.getFutureDbCacheSizeForTesting(), 2);
        })();
        await futureDatabase.flush();
        assert.strictEqual(impl.getMethodDbCacheSizeForTesting(), 1);

        await forceGarbageCollection();
        assert.strictEqual(impl.getFutureDbCacheSizeForTesting(), 0);
        assert.strictEqual(impl.getMethodDbCacheSizeForTesting(), 1);

        // This will result in the method be retrieved from the cache
        futures.resolveFutureById(futureId);
      });

      test('will only be cached once when it circularly references itself', async (t) => {
        const dbPath = randomDatabasePath();
        t.after(() => {
          cleanupDbFiles(dbPath);
        });
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const impl = futureDatabase[GetFutureDatabase]();

        const { methods, containers } = createFutureMachine(futureDatabase);

        type HolderMethod = Method<(holder: Dictionary<HolderMethod>) => void>;

        const method = methods.create(
          'method',
          (_methodHolder: Dictionary<HolderMethod>) => {}
        );
        assert.strictEqual(impl.getMethodDbCacheSizeForTesting(), 0);

        const futures = methods.build();

        const { future } = futures.withResolvers<void>();

        const holder = containers.dictionary.create<HolderMethod>();
        const boundMethod = method.bindArgs(holder);
        holder.set('boundMethod', boundMethod);

        future.next(boundMethod);

        await futureDatabase.flush();
        assert.strictEqual(impl.getMethodDbCacheSizeForTesting(), 1);
      });
    });

    describe('future', () => {
      test("Futures can't be garbage collected when they have pending reactions to write", async (t) => {
        const dbPath = randomDatabasePath();
        t.after(() => {
          cleanupDbFiles(dbPath);
        });
        const futureDatabase = new SQLFutureDatabase(dbPath);
        const impl = futureDatabase[GetFutureDatabase]();

        const { methods, containers } = createFutureMachine(futureDatabase);

        type structType = { unique_world: number };

        const { promise, resolve } =
          Promise.withResolvers<Struct<structType>>();

        const method = methods.create(
          'method',
          (struct: Struct<structType>) => {
            resolve(struct);
          }
        );

        const futures = methods.build();

        let futureId: FutureId<void>;

        let struct1: Struct<structType>;
        await (async () => {
          const { future, id } = futures.withResolvers<void>();
          futureId = id;
          await futureDatabase.flush();

          struct1 = containers.struct.create({
            unique_world: 3,
          });
          future.next(method.bindArgs(struct1));
        })();

        // Two futures in the db cache: one for the `futureId` and one for its
        // reaction.
        assert.strictEqual(impl.getFutureDbCacheSizeForTesting(), 2);
        assert.strictEqual(impl.getMethodDbCacheSizeForTesting(), 0);
        assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 0);

        // Flush so that its not being kept alive by a pending write.
        await forceGarbageCollection();

        // The future for `futureId` has a pending reaction to write so it is kept
        // alive.
        assert.strictEqual(impl.getFutureDbCacheSizeForTesting(), 2);
        assert.strictEqual(impl.getMethodDbCacheSizeForTesting(), 0);
        assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 0);

        // We resolve the future for `futureId` and get it from the cache.
        futures.resolveFutureById(futureId!);

        // Despite the struct not being in the cache, we get the same struct since
        // we retrieved it through the cached future.
        const struct2 = await promise;
        assert.strictEqual(struct1!.unique_world, 3);
        assert.strictEqual(struct2.unique_world, 3);

        // We can prove that its the same by modifying the original and changing
        // it.
        struct1!.unique_world = 4;
        assert.strictEqual(struct1!.unique_world, 4);
        assert.strictEqual(struct2.unique_world, 4);

        assert.strictEqual(impl.getFutureDbCacheSizeForTesting(), 2);
        assert.strictEqual(impl.getMethodDbCacheSizeForTesting(), 0);
        assert.strictEqual(impl.getObjectDbCacheSizeForTesting(), 0);

        await futureDatabase.close();
      });
    });
  });
});
