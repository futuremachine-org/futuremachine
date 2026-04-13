import { assert_defined } from '../asserts.js';

type BoundaryType = (...args: never[]) => unknown;

const exception_boundary_map_global = new Map<BoundaryType, number>();

// This allows library functions to exclude themselves from the stack trace.
export class ExceptionBoundary implements Disposable {
  constructor(private boundary: BoundaryType) {
    const entryCount = exception_boundary_map_global.get(this.boundary);
    exception_boundary_map_global.set(this.boundary, (entryCount ?? 0) + 1);
  }
  [Symbol.dispose]() {
    const entryCount = exception_boundary_map_global.get(this.boundary);
    assert_defined(entryCount, 'entryCount was not defined');
    if (entryCount === 1) {
      exception_boundary_map_global.delete(this.boundary);
    } else {
      exception_boundary_map_global.set(this.boundary, entryCount - 1);
    }
  }
}

// TODO: I guess the real logic we want is to cut off at the highest point we
// can that doesn't exclude any of the caller code. so we actually need to mark
// when we enter user code.

// Gets the highest boundary that hasn't been recursively entered.
export function getExceptionBoundaryGlobal(): BoundaryType | undefined {
  for (const [boundary, entryCount] of exception_boundary_map_global) {
    if (entryCount === 1) {
      return boundary;
    }
  }
  return undefined;
}
