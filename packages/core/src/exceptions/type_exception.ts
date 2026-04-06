import {
  Exception,
  type ExceptionOptions,
  type ExceptionState,
} from './exception.js';

export class TypeException<
  T extends ExceptionState = ExceptionState,
> extends Exception<T> {
  public static createTypeExceptionState(
    message?: string,
    options?: ExceptionOptions
  ): ExceptionState {
    return Exception.createExceptionState(message, options);
  }

  public get name(): string {
    return 'TypeException';
  }
}
