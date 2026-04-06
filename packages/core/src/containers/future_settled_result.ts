import type { Serializable } from '../database/future_database.js';
import { Entity } from './entity.js';
import type { FutureSettledResultState } from './future_settled_result_impl.js';

export type FutureFulfilledResult<T extends Serializable> = FutureSettledResult<
  T,
  'fulfilled'
>;
export type FutureRejectedResult<T extends Serializable> = FutureSettledResult<
  T,
  'rejected'
>;

export class FutureSettledResult<
  T extends Serializable,
  S extends 'fulfilled' | 'rejected' = 'fulfilled' | 'rejected',
> extends Entity<FutureSettledResultState<S>> {
  public get status(): S {
    return this.get('status');
  }

  public get value(): S extends 'fulfilled' ? T : undefined {
    return (
      this.status == 'fulfilled' ? this.get('value') : undefined
    ) as S extends 'fulfilled' ? T : undefined;
  }

  public get reason(): S extends 'rejected' ? Serializable : undefined {
    return (
      this.status == 'rejected' ? this.get('value') : undefined
    ) as S extends 'rejected' ? Serializable : undefined;
  }
}
