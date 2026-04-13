import type { State } from '../containers/entity_impl.js';
import {
  ExceptionBoundary,
  getExceptionBoundaryGlobal,
} from './exception_boundary.js';
import { ExceptionEntity } from './exception_entity.js';

export type ExceptionState = {
  message: string;
  cause: string | undefined;
  stack: string;
};

export type ExceptionOptions = {
  cause?: string;
};

function getStack() {
  const boundary = getExceptionBoundaryGlobal();
  const error: { stack: string | undefined } = { stack: undefined };
  Error.captureStackTrace(error, boundary);
  return error.stack!.split('\n').slice(1).join('\n');
}

export class Exception<
  T extends ExceptionState = ExceptionState,
> extends ExceptionEntity<T> {
  public static createExceptionState(
    message?: string,
    options?: ExceptionOptions
  ): ExceptionState {
    using _ = new ExceptionBoundary(this.createExceptionState);

    return {
      message: message ?? '',
      // TODO: Accessing `cause` could throw or potentially call
      // createExceptionState again. We should add tests for both cases.
      cause: options?.cause,
      stack: getStack(),
    };
  }

  constructor(state: State<T>) {
    super(state);
    this.setupStack();
  }

  private setupStack() {
    let stackStr = this.toString();
    const stack = this.get('stack');

    // Don't add a return line for an empty stack.
    if (stack.length > 0) {
      stackStr += `\n${this.get('stack')}`;
    }

    Object.defineProperty(this, 'stack', {
      value: stackStr,
      writable: false,
      enumerable: false,
    });
  }

  public get name(): string {
    return 'Exception';
  }

  public get message(): string {
    return this.get('message');
  }

  public get cause(): string | undefined {
    return this.get('cause');
  }

  public toString() {
    if (this.name === '') {
      return this.message;
    }
    if (this.message === '') {
      return this.name;
    }
    return `${this.name}: ${this.message}`;
  }

  declare public readonly stack: string;
}
