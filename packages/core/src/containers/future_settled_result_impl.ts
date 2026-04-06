import type { Serializable } from '../database/future_database.js';

export type FutureSettledResultState<
  S extends 'fulfilled' | 'rejected' = 'fulfilled' | 'rejected',
> = {
  status: S;
  value: Serializable;
};
