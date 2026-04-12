import type { Serializable } from '../database/future_database.js';
import type { Struct } from './struct.js';

export type FutureFulfilledResult<T extends Serializable> = Struct<{
  status: 'fulfilled';
  value?: T;
}>;
export type FutureRejectedResult = Struct<{
  status: 'rejected';
  reason: Serializable;
}>;

export type FutureSettledResult<T extends Serializable> =
  | FutureFulfilledResult<T>
  | FutureRejectedResult;
