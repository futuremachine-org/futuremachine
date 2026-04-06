import type {
  MethodDB,
  Serializable,
  SerializableDB,
} from '../database/future_database.js';
import { deserializeArgs, serializeArgs } from '../database/serialize_utils.js';
import type { ValidResult } from './future_impl.js';
import type { FutureMachineImpl } from './future_machine_impl.js';

export type MethodName = string;

// TODO: Should we make the return type any again?
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMethodImpl = (...args: any[]) => ValidResult<Serializable>;

export class MethodImpl<Impl extends AnyMethodImpl> {
  private constructor(
    private futureMachineImpl: FutureMachineImpl,
    public impl: Impl,
    private methodDb: MethodDB
  ) {}

  public static create<Impl extends AnyMethodImpl>(
    futureMachineImpl: FutureMachineImpl,
    impl: Impl,
    methodDb: MethodDB
  ) {
    return new MethodImpl(futureMachineImpl, impl, methodDb);
  }

  public getMethodDb(): MethodDB {
    return this.methodDb;
  }

  public getName(): MethodName {
    return this.methodDb.getName();
  }

  private getBounded(): Iterable<SerializableDB> {
    return this.methodDb.getBounded();
  }

  public run(...args: Parameters<Impl>): ReturnType<Impl> {
    return this.impl(
      ...deserializeArgs(this.futureMachineImpl, this.getBounded()),
      ...args
    ) as ReturnType<Impl>;
  }

  public bind<
    A extends Serializable[],
    B extends unknown[],
    R extends ValidResult<Serializable>,
  >(
    this: MethodImpl<(...args: [...A, ...B]) => R>,
    ...args: A
  ): MethodImpl<(...args: B) => R> {
    return new MethodImpl<(...args: [...B]) => R>(
      this.futureMachineImpl,
      // `this.impl` is `(...args: [...A, ...B]) => R` but `MethodImpl`'s
      // constructor expects a `(...args: [...B]) => R`.
      this.impl as unknown as (...args: [...B]) => R,
      this.getMethodDb().pushBounded(serializeArgs(args))
    );
  }
}
