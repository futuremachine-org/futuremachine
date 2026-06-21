import type { Serializable } from '../database/future_database.js';
import type { Struct } from './struct.js';

/**
 * @category Future
 */
export type FutureFulfilledResult<T extends Serializable> = Struct<{
  status: 'fulfilled';
  value?: T;
}>;

/**
 * @category Future
 */
export type FutureRejectedResult = Struct<{
  status: 'rejected';
  reason: Serializable;
}>;

/**
 * @category Future
 */
export type FutureSettledResult<T extends Serializable> =
  | FutureFulfilledResult<T>
  | FutureRejectedResult;
