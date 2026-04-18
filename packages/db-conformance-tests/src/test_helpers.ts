import type {
  FutureSettledResult,
  List,
  Method,
  MethodName,
  Methods,
  Serializable,
  SimpleFutureDatabase,
} from '@futuremachine/core';
import { AggregateException } from '@futuremachine/core';
import { strict as assert } from 'node:assert';

type createMethodReturnType<Params, Return extends Serializable> = {
  method: Method<(params: Params) => Return>;
  promise: Promise<Params>;
};

const idGenerator = (() => {
  let idCounter = 0;
  return () => `method-${idCounter++}`;
})();

export function createMethod<Params>(
  methods: Methods
): createMethodReturnType<Params, undefined>;

export function createMethod<Params, Return extends Serializable>(
  methods: Methods,
  retValue: Return
): createMethodReturnType<Params, Return>;

export function createMethod<Params, Return extends Serializable>(
  methods: Methods,
  retValue?: Return
): createMethodReturnType<Params, Return> {
  return createMethodWithName(methods, idGenerator(), retValue as Return);
}

export function createMethodWithName<Params>(
  methods: Methods,
  name: MethodName
): createMethodReturnType<Params, undefined>;

export function createMethodWithName<Params, Return extends Serializable>(
  methods: Methods,
  name: MethodName,
  retValue: Return
): createMethodReturnType<Params, Return>;

export function createMethodWithName<Params, Return extends Serializable>(
  methods: Methods,
  name: MethodName,
  retValue?: Return
): createMethodReturnType<Params, Return> {
  const { promise, resolve } = Promise.withResolvers<Params>();
  const method = methods.create(name, (args: Params) => {
    resolve(args);
    return retValue as Return;
  });
  return { method, promise };
}

export function isFutureDatabaseEmpty(futureDatabase: SimpleFutureDatabase) {
  const state = futureDatabase.getState();
  return state.futureMap.size === 0;
}

export async function assertPromiseRejects<T>(
  promise: Promise<T>,
  expectedReason: unknown
) {
  await assert.rejects(promise, (actualReason) => {
    assert.strictEqual(actualReason, expectedReason);
    return true;
  });
}

export type AnyFutureSettledResult<T extends Serializable> = {
  status: 'fulfilled' | 'rejected';
  value?: T;
  reason?: Serializable;
};

export function assertFutureSettledResultEquals<T extends Serializable>(
  actual: FutureSettledResult<T>,
  expected: AnyFutureSettledResult<T>
) {
  const { status, value, reason } = actual as AnyFutureSettledResult<T>;
  const copy: AnyFutureSettledResult<Serializable> = { status };
  if (value !== undefined) {
    copy.value = value;
  }
  if (reason !== undefined) {
    copy.reason = reason;
  }
  assert.deepStrictEqual(copy, expected);
}

export function assertFutureSettledResultListEquals<T extends Serializable>(
  actual: List<FutureSettledResult<T>[]>,
  expected: AnyFutureSettledResult<T>[]
) {
  const actualCopies = [...actual].map((actual) => {
    const { status, value, reason } = actual as AnyFutureSettledResult<T>;
    const copy: AnyFutureSettledResult<Serializable> = { status };
    if (value !== undefined) {
      copy.value = value;
    }
    if (reason !== undefined) {
      copy.reason = reason;
    }

    return copy;
  });
  assert.deepStrictEqual(actualCopies, expected);
}

export async function getPromiseRejectReason(
  promise: Promise<Serializable>
): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("Promise didn't reject");
}

export function assertIsAggregateException(
  exception: unknown,
  results: Serializable[]
) {
  assert.ok(exception instanceof AggregateException);
  assert.deepStrictEqual([...exception.errors], results);
  assert.strictEqual(exception.name, 'AggregateException');
  assert.strictEqual(exception.message, 'All futures were rejected');
  assert.strictEqual(exception.cause, undefined);
  assert.strictEqual(
    exception.toString(),
    'AggregateException: All futures were rejected'
  );
  assert.strictEqual(
    exception.stack,
    'AggregateException: All futures were rejected'
  );
}

export async function assertPromiseRejectsWithAggregateException(
  promise: Promise<Serializable>,
  results: Serializable[]
) {
  const exception = await getPromiseRejectReason(promise);
  assertIsAggregateException(exception, results);
}
