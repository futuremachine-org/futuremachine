import type { List } from '../containers/list.js';
import type { Serializable } from '../database/future_database.js';
import {
  Exception,
  type ExceptionOptions,
  type ExceptionState,
} from './exception.js';

export type AggregateExceptionState = ExceptionState & {
  errors: List<Serializable[]>;
};

export class AggregateException<
  T extends AggregateExceptionState = AggregateExceptionState,
> extends Exception<T> {
  public static createAggregateExceptionState(
    errors: List<Serializable[]>,
    message?: string,
    options?: ExceptionOptions
  ): AggregateExceptionState {
    return {
      ...Exception.createExceptionState(message, options),
      errors,
      stack: '',
    };
  }

  public get name(): string {
    return 'AggregateException';
  }

  public get errors() {
    return this.get('errors');
  }
}
