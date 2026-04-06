/* c8 ignore start */

export function assert_defined<T>(
  value: T | undefined,
  message: string
): asserts value is T {
  if (value === undefined) {
    throw new Error(`Assert: ${message}`);
  }
}

export function assert_not_null<T>(
  value: T | null,
  message: string
): asserts value is T {
  if (value === null) {
    throw new Error(`Assert: ${message}`);
  }
}

export function assert_equal<T>(expected: T, actual: T, message: string) {
  if (expected !== actual) {
    throw new Error(`Assert: ${message}`);
  }
}

export function assert_not_equal<T>(expected: T, actual: T, message: string) {
  if (expected === actual) {
    throw new Error(`Assert: ${message}`);
  }
}

export function assert_less_than(
  expected: number,
  actual: number,
  message: string
) {
  if (expected >= actual) {
    throw new Error(`Assert: ${message}`);
  }
}

export function assert_true(value: boolean, message: string) {
  if (value !== true) {
    throw new Error(`Assert: ${message}`);
  }
}

export function assert_false(value: boolean, message: string) {
  if (value !== false) {
    throw new Error(`Assert: ${message}`);
  }
}

export function assert_unreached(message: string): never {
  throw new Error(`Assert: ${message}`);
}

/* c8 ignore end */
