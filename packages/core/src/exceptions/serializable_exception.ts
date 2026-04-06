import {
  Exception,
  type ExceptionOptions,
  type ExceptionState,
} from './exception.js';

export class SerializableException<
  T extends ExceptionState = ExceptionState,
> extends Exception<T> {
  public static createSerializableExceptionState(
    message?: string,
    options?: ExceptionOptions
  ): ExceptionState {
    return Exception.createExceptionState(message, options);
  }

  public get name(): string {
    return 'SerializableException';
  }

  // TODO: Add info about what couldn't be serialized.
}
