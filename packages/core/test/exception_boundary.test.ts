import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  ExceptionBoundary,
  getExceptionBoundaryGlobal,
} from '../src/exceptions/exception_boundary.js';

describe('SimpleFutureDatabase', () => {
  test('is undefined if no exception boundary has been set', async () => {
    assert.strictEqual(getExceptionBoundaryGlobal(), undefined);
  });

  test('is the exception boundary set if there is only one', async () => {
    function test() {}
    using _ = new ExceptionBoundary(test);
    assert.strictEqual(getExceptionBoundaryGlobal(), test);
  });

  test('is the first exception boundary set', async () => {
    function test() {}
    function test2() {}
    using _1 = new ExceptionBoundary(test);
    using _2 = new ExceptionBoundary(test2);
    assert.strictEqual(getExceptionBoundaryGlobal(), test);
  });

  test('is undefined if all exception boundaries have been set more than once', async () => {
    function test() {}
    using _1 = new ExceptionBoundary(test);
    using _2 = new ExceptionBoundary(test);
    assert.strictEqual(getExceptionBoundaryGlobal(), undefined);
  });

  test("doesn't use unset exception boundaries", async () => {
    function test() {}
    function test2() {}
    {
      using _1 = new ExceptionBoundary(test);
    }
    using _2 = new ExceptionBoundary(test2);
    assert.strictEqual(getExceptionBoundaryGlobal(), test2);
  });

  test('will use a exception boundary again once its been reduced back down to one', async () => {
    function test() {}
    function test2() {}
    {
      using _1 = new ExceptionBoundary(test);
      using _2 = new ExceptionBoundary(test2);
      assert.strictEqual(getExceptionBoundaryGlobal(), test);
      {
        using _3 = new ExceptionBoundary(test);
        assert.strictEqual(getExceptionBoundaryGlobal(), test2);
      }
      assert.strictEqual(getExceptionBoundaryGlobal(), test);
    }
    assert.strictEqual(getExceptionBoundaryGlobal(), undefined);
    using _4 = new ExceptionBoundary(test2);
    assert.strictEqual(getExceptionBoundaryGlobal(), test2);
  });
});
