import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { createMethodMachine } from '../../src/index.js';

import type {
  AggregateExceptionState,
  ExceptionState,
  FutureId,
  List,
  Serializable,
  StateBuilder,
} from '../../src/index.js';
import {
  AggregateException,
  Exception,
  SerializableException,
  TypeException,
} from '../../src/index.js';
import { type TestSettings } from '../export_tests.js';

export default (testSettings: TestSettings) => {
  describe('Exception', () => {
    test('can be constructed without arguments', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions } = createMethodMachine(futureDatabase);

      methods.build();

      const exception: Exception = exceptions.createException();

      assert.strictEqual(exception.name, 'Exception');
      assert.strictEqual(exception.message, '');
      assert.strictEqual(exception.cause, undefined);
      assert.strictEqual(exception.toString(), 'Exception');

      await dbHolder.close(futureDatabase);
    });

    test('can be constructed with arguments', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions } = createMethodMachine(futureDatabase);

      methods.build();

      const message = 'Hello world';
      const cause = 'Fizz buzz';
      const exception: Exception = exceptions.createException(message, {
        cause,
      });

      assert.strictEqual(exception.name, 'Exception');
      assert.strictEqual(exception.message, message);
      assert.strictEqual(exception.cause, cause);
      assert.strictEqual(exception.toString(), `Exception: ${message}`);

      await dbHolder.close(futureDatabase);
    });

    test('can be extended', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods } = createMethodMachine(futureDatabase);

      type customExceptionState = ExceptionState & {
        customProp: number;
      };

      const name = 'CustomException';
      const cause = 'Hello world';
      const message = 'Fizz Buzz';

      class CustomException extends Exception<customExceptionState> {
        public get customProp(): number {
          return this.get('customProp');
        }
        public set customProp(value: number) {
          this.set('customProp', value);
        }

        public get name(): string {
          return name;
        }
      }

      const createCustomException = methods.registerEntity(
        'CustomException',
        CustomException,
        (stateBuilder: StateBuilder) => (customProp: number) => {
          return new CustomException(
            stateBuilder.build({
              ...Exception.createExceptionState(message, {
                cause,
              }),
              customProp,
            })
          );
        }
      );

      methods.build();

      const customProp1 = 1234;
      const exception: CustomException = createCustomException(customProp1);

      assert.strictEqual(exception.customProp, customProp1);
      assert.strictEqual(exception.name, name);
      assert.strictEqual(exception.message, message);
      assert.strictEqual(exception.cause, cause);
      assert.strictEqual(exception.toString(), `CustomException: ${message}`);

      const customProp2 = 4321;
      exception.customProp = customProp2;
      assert.strictEqual(exception.customProp, customProp2);

      await dbHolder.close(futureDatabase);
    });

    test('toString() returns just the message if the name is blank', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods } = createMethodMachine(futureDatabase);

      type customExceptionState = ExceptionState & {
        customProp: number;
      };

      const name = '';
      const cause = 'Hello world';
      const message = 'Fizz Buzz';

      class CustomException extends Exception<customExceptionState> {
        public get customProp(): number {
          return this.get('customProp');
        }

        public get name(): string {
          return name;
        }
      }

      const createCustomException = methods.registerEntity(
        'CustomException',
        CustomException,
        (stateBuilder: StateBuilder) => () => {
          return new CustomException(
            stateBuilder.build({
              ...Exception.createExceptionState(message, {
                cause,
              }),
              customProp: 1,
            })
          );
        }
      );

      methods.build();

      const exception: Exception = createCustomException();

      assert.strictEqual(exception.name, name);
      assert.strictEqual(exception.message, message);
      assert.strictEqual(exception.cause, cause);
      assert.strictEqual(exception.toString(), message);

      await dbHolder.close(futureDatabase);
    });

    test('can be bound to Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, exceptions } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<Exception>();
        const method = methods.create('method', (exception: Exception) => {
          resolve(exception);
        });

        const futureMachine = methods.build();

        return { exceptions, futureDatabase, method, futureMachine, promise };
      }

      const message = 'Hello world';
      const cause = 'Fizz buzz';
      let stack: string;

      let futureId: FutureId<void>;

      {
        const { exceptions, futureDatabase, method, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        // Add a frame to the stack;
        function createException() {
          return exceptions.createException(message, { cause });
        }
        const exception = createException();

        stack = exception.stack;

        future.next(method.bindArgs(exception));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const exception = await promise;

        assert.strictEqual(exception.name, 'Exception');
        assert.strictEqual(exception.message, message);
        assert.strictEqual(exception.cause, cause);
        assert.strictEqual(exception.toString(), `Exception: ${message}`);
        assert.strictEqual(exception.stack, stack);

        await dbHolder.close(futureDatabase);
      }
    });

    test('stack begins with toString()', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions } = createMethodMachine(futureDatabase);

      methods.build();

      const exception: Exception = exceptions.createException();

      assert.strictEqual(
        exception.stack.split('\n').at(0),
        exception.toString()
      );

      await dbHolder.close(futureDatabase);
    });

    test("stack doesn't include the Error's toString()", async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions } = createMethodMachine(futureDatabase);

      methods.build();

      const exception: Exception = exceptions.createException();

      assert.doesNotMatch(exception.stack, /^Error/m);

      await dbHolder.close(futureDatabase);
    });

    test('stack is not writable', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions } = createMethodMachine(futureDatabase);

      methods.build();

      const exception: Exception = exceptions.createException();

      assert.throws(() => {
        (exception.stack as string) = 'Hello world!';
      });

      assert.strictEqual(
        exception.stack.split('\n').at(0),
        exception.toString()
      );

      await dbHolder.close(futureDatabase);
    });

    test('stack is not enumerable', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions } = createMethodMachine(futureDatabase);

      methods.build();

      const exception: Exception = exceptions.createException();

      for (const prop in exception) {
        assert.notStrictEqual(prop, 'stack');
      }

      assert.strictEqual(
        exception.stack.split('\n').at(0),
        exception.toString()
      );

      await dbHolder.close(futureDatabase);
    });

    test("stack doesn't include createException", async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions } = createMethodMachine(futureDatabase);

      methods.build();

      const exception: Exception = exceptions.createException();
      assert.doesNotMatch(exception!.stack, /createException/);
      assert.notStrictEqual(exception.stack, exception.toString());

      await dbHolder.close(futureDatabase);
    });

    test('stack includes createException if it was called within a call to createException', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions } = createMethodMachine(futureDatabase);

      methods.build();

      let exception: Exception;

      exceptions.createException('', {
        get cause(): string {
          exception = exceptions.createException();
          return '';
        },
      });
      assert.match(exception!.stack, /createException/);
      assert.notStrictEqual(exception!.stack, exception!.toString());

      await dbHolder.close(futureDatabase);
    });
  });

  describe('TypeException', () => {
    test('can be constructed with arguments', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions } = createMethodMachine(futureDatabase);

      methods.build();

      const message = 'Hello world';
      const cause = 'Fizz buzz';
      const exception: TypeException = exceptions.createTypeException(message, {
        cause,
      });

      assert.strictEqual(exception.name, 'TypeException');
      assert.strictEqual(exception.message, message);
      assert.strictEqual(exception.cause, cause);
      assert.strictEqual(exception.toString(), `TypeException: ${message}`);

      await dbHolder.close(futureDatabase);
    });

    test('can be extended', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods } = createMethodMachine(futureDatabase);

      type customExceptionState = ExceptionState & {
        customProp: number;
      };

      const name = 'CustomException';
      const cause = 'Hello world';
      const message = 'Fizz Buzz';

      class CustomException extends TypeException<customExceptionState> {
        public get customProp(): number {
          return this.get('customProp');
        }

        public get name(): string {
          return name;
        }
      }

      const createCustomException = methods.registerEntity(
        'CustomException',
        CustomException,
        (stateBuilder: StateBuilder) => () => {
          return new CustomException(
            stateBuilder.build({
              ...TypeException.createTypeExceptionState(message, {
                cause,
              }),
              customProp: 1,
            })
          );
        }
      );

      methods.build();

      const exception: TypeException = createCustomException();

      assert.strictEqual(exception.name, name);
      assert.strictEqual(exception.message, message);
      assert.strictEqual(exception.cause, cause);
      assert.strictEqual(exception.toString(), `CustomException: ${message}`);

      await dbHolder.close(futureDatabase);
    });

    test('can be bound to Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, exceptions } = createMethodMachine(futureDatabase);

        const { promise, resolve } = Promise.withResolvers<TypeException>();
        const method = methods.create('method', (exception: TypeException) => {
          resolve(exception);
        });

        const futureMachine = methods.build();

        return { exceptions, futureDatabase, method, futureMachine, promise };
      }

      const message = 'Hello world';
      const cause = 'Fizz buzz';

      let futureId: FutureId<void>;

      {
        const { exceptions, futureDatabase, method, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        // Add a frame to the stack;
        function createTypeException() {
          return exceptions.createTypeException(message, { cause });
        }
        const exception = createTypeException();

        future.next(method.bindArgs(exception));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const exception = await promise;

        assert.strictEqual(exception.name, 'TypeException');
        assert.strictEqual(exception.message, message);
        assert.strictEqual(exception.cause, cause);
        assert.strictEqual(exception.toString(), `TypeException: ${message}`);

        await dbHolder.close(futureDatabase);
      }
    });
    test("stack doesn't include createTypeException", async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions } = createMethodMachine(futureDatabase);

      methods.build();

      const exception: Exception = exceptions.createTypeException();
      assert.doesNotMatch(exception.stack, /createTypeException/);
      assert.notStrictEqual(exception.stack, exception.toString());

      await dbHolder.close(futureDatabase);
    });
  });

  describe('AggregateException', () => {
    test('can be constructed with arguments', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions, containers } =
        createMethodMachine(futureDatabase);

      methods.build();

      const message = 'Hello world';
      const cause = 'Fizz buzz';
      const exception: AggregateException = exceptions.createAggregateException(
        containers.createList(),
        message,
        {
          cause,
        }
      );

      assert.strictEqual(exception.name, 'AggregateException');
      assert.strictEqual(exception.message, message);
      assert.strictEqual(exception.cause, cause);
      assert.strictEqual(
        exception.toString(),
        `AggregateException: ${message}`
      );

      await dbHolder.close(futureDatabase);
    });

    test('can be extended', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, containers } = createMethodMachine(futureDatabase);

      type customExceptionState = AggregateExceptionState & {
        customProp: number;
      };

      const name = 'CustomException';
      const cause = 'Hello world';
      const message = 'Fizz Buzz';

      class CustomException extends AggregateException<customExceptionState> {
        public get customProp(): number {
          return this.get('customProp');
        }

        public get name(): string {
          return name;
        }
      }

      const createCustomException = methods.registerEntity(
        'CustomException',
        CustomException,
        (stateBuilder: StateBuilder) => (errors: List<Serializable[]>) => {
          return new CustomException(
            stateBuilder.build({
              ...AggregateException.createAggregateExceptionState(
                errors,
                message,
                {
                  cause,
                }
              ),
              customProp: 1,
            })
          );
        }
      );

      methods.build();

      const exception: AggregateException = createCustomException(
        containers.createList()
      );

      assert.strictEqual(exception.name, name);
      assert.strictEqual(exception.message, message);
      assert.strictEqual(exception.cause, cause);
      assert.strictEqual(exception.toString(), `CustomException: ${message}`);

      await dbHolder.close(futureDatabase);
    });

    test('can be bound to Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, exceptions, containers } =
          createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<AggregateException>();
        const method = methods.create(
          'method',
          (exception: AggregateException) => {
            resolve(exception);
          }
        );

        const futureMachine = methods.build();

        return {
          exceptions,
          containers,
          futureDatabase,
          method,
          futureMachine,
          promise,
        };
      }

      const message = 'Hello world';
      const cause = 'Fizz buzz';

      let futureId: FutureId<void>;

      {
        const {
          exceptions,
          containers,
          futureDatabase,
          method,
          futureMachine,
        } = await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        // Add a frame to the stack;
        function createAggregateException() {
          return exceptions.createAggregateException(
            containers.createList(),
            message,
            { cause }
          );
        }
        const exception = createAggregateException();

        future.next(method.bindArgs(exception));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const exception = await promise;

        assert.strictEqual(exception.name, 'AggregateException');
        assert.strictEqual(exception.message, message);
        assert.strictEqual(exception.cause, cause);
        assert.strictEqual(
          exception.toString(),
          `AggregateException: ${message}`
        );

        await dbHolder.close(futureDatabase);
      }
    });
    test("stack doesn't include createAggregateException", async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions, containers } =
        createMethodMachine(futureDatabase);

      methods.build();

      const exception: Exception = exceptions.createAggregateException(
        containers.createList()
      );
      assert.doesNotMatch(exception.stack, /createAggregateException/);
      // TODO: This should be true when the AggregateException is made by us:
      // assert.notStrictEqual(exception.stack, exception.toString());

      await dbHolder.close(futureDatabase);
    });
  });

  describe('SerializableException', () => {
    test('can be constructed with arguments', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions } = createMethodMachine(futureDatabase);

      methods.build();

      const message = 'Hello world';
      const cause = 'Fizz buzz';
      const exception: SerializableException =
        exceptions.createSerializableException(message, {
          cause,
        });

      assert.strictEqual(exception.name, 'SerializableException');
      assert.strictEqual(exception.message, message);
      assert.strictEqual(exception.cause, cause);
      assert.strictEqual(
        exception.toString(),
        `SerializableException: ${message}`
      );

      await dbHolder.close(futureDatabase);
    });

    test('can be extended', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods } = createMethodMachine(futureDatabase);

      type customExceptionState = ExceptionState & {
        customProp: number;
      };

      const name = 'CustomException';
      const cause = 'Hello world';
      const message = 'Fizz Buzz';

      class CustomException extends SerializableException<customExceptionState> {
        public get customProp(): number {
          return this.get('customProp');
        }

        public get name(): string {
          return name;
        }
      }

      const createCustomException = methods.registerEntity(
        'CustomException',
        CustomException,
        (stateBuilder: StateBuilder) => () => {
          return new CustomException(
            stateBuilder.build({
              ...SerializableException.createSerializableExceptionState(
                message,
                {
                  cause,
                }
              ),
              customProp: 1,
            })
          );
        }
      );

      methods.build();

      const exception: SerializableException = createCustomException();

      assert.strictEqual(exception.name, name);
      assert.strictEqual(exception.message, message);
      assert.strictEqual(exception.cause, cause);
      assert.strictEqual(exception.toString(), `CustomException: ${message}`);

      await dbHolder.close(futureDatabase);
    });

    test('can be bound to Methods across sessions', async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);

      async function createMethods() {
        const futureDatabase = await dbHolder.createDbInstance();
        const { methods, exceptions } = createMethodMachine(futureDatabase);

        const { promise, resolve } =
          Promise.withResolvers<SerializableException>();
        const method = methods.create(
          'method',
          (exception: SerializableException) => {
            resolve(exception);
          }
        );

        const futureMachine = methods.build();

        return { exceptions, futureDatabase, method, futureMachine, promise };
      }

      const message = 'Hello world';
      const cause = 'Fizz buzz';

      let futureId: FutureId<void>;

      {
        const { exceptions, futureDatabase, method, futureMachine } =
          await createMethods();
        const { future, id } = futureMachine.withResolvers<void>();
        futureId = id;

        // Add a frame to the stack;
        function createSerializableException() {
          return exceptions.createSerializableException(message, { cause });
        }
        const exception = createSerializableException();

        future.next(method.bindArgs(exception));
        await dbHolder.close(futureDatabase);
      }

      {
        const { futureDatabase, futureMachine, promise } =
          await createMethods();
        futureMachine.resolveFutureById(futureId);

        const exception = await promise;

        assert.strictEqual(exception.name, 'SerializableException');
        assert.strictEqual(exception.message, message);
        assert.strictEqual(exception.cause, cause);
        assert.strictEqual(
          exception.toString(),
          `SerializableException: ${message}`
        );

        await dbHolder.close(futureDatabase);
      }
    });
    test("stack doesn't include createSerializableException", async (t) => {
      const dbHolder = await testSettings.createDbHolder();
      dbHolder.addCleanup(t);
      const futureDatabase = await dbHolder.createDbInstance();
      const { methods, exceptions } = createMethodMachine(futureDatabase);

      methods.build();

      const exception: Exception = exceptions.createSerializableException();
      assert.doesNotMatch(exception.stack, /createSerializableException/);
      assert.notStrictEqual(exception.stack, exception.toString());

      await dbHolder.close(futureDatabase);
    });
  });
};
