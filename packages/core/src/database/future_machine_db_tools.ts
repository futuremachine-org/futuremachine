import type { FutureMachineImpl } from '../core/future_machine_impl.js';
import { FutureMachineDBToolsCreate } from '../symbols.js';

export class FutureMachineDBTools {
  private constructor(private futureMachineImpl: FutureMachineImpl) {}

  public static [FutureMachineDBToolsCreate](
    futureMachineImpl: FutureMachineImpl
  ) {
    return new FutureMachineDBTools(futureMachineImpl);
  }

  public onActivitySettled(): Promise<void> {
    return this.futureMachineImpl.onActivitySettled();
  }
}
