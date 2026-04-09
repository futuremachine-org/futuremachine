import {
  ActionType,
  FuzzerPlan,
  MethodActionType,
  ValueTypes,
  type AnyValue,
  type MethodInstructions,
  type PrimitiveRawTypes,
} from './fuzzer_plan.js';

class TestObject {
  public value = 0;
}

export class PromiseExecutor {
  private promises: Map<number, Partial<PromiseWithResolvers<unknown>>> =
    new Map();
  private methods: Map<
    string,
    {
      method: (...args: unknown[]) => unknown;
      boundArgs: AnyValue[];
    }
  > = new Map();
  private objects: Map<number, TestObject> = new Map();

  private events: unknown[] = [];

  public getEvents(): unknown[] {
    return this.events;
  }

  // TODO: event type
  private recordEvent(event: { methodName: string; args: unknown[] }) {
    this.events.push(structuredClone(event));
  }

  private methodNameToMethod(
    methodName: string
  ): (...args: unknown[]) => unknown {
    const method = this.methods.get(methodName);
    if (!method) {
      throw new Error('Method not found');
    }
    return method.method.bind(
      this,
      ...method.boundArgs.map(this.valueToReal.bind(this))
    );
  }

  private valueToReal(
    value: AnyValue
  ):
    | Promise<unknown>
    | ((...args: unknown[]) => unknown)
    | TestObject
    | PrimitiveRawTypes {
    switch (value.type) {
      case ValueTypes.Future: {
        const future = this.promises.get(value.futureId)?.promise;
        if (!future) {
          throw new Error('Future not found');
        }
        return future;
      }
      case ValueTypes.Method:
        return this.methodNameToMethod(value.methodName);
      case ValueTypes.Obj: {
        let obj = this.objects.get(value.objectId);
        if (!obj) {
          obj = new TestObject();
          this.objects.set(value.objectId, obj);
        }
        return obj;
      }
      case ValueTypes.Primitive:
        return value.value;
    }
  }

  private executeMethodInstructions(
    methodName: string,
    instructions: MethodInstructions,
    ...args: unknown[]
  ) {
    const { methodAction, modifyObjects } = instructions;
    this.recordEvent({
      methodName,
      args,
    });
    for (const { argIndex, value } of modifyObjects) {
      const obj = args[argIndex] as TestObject;
      obj.value = value;
    }
    switch (methodAction.type) {
      case MethodActionType.ReturnArg:
        return args[methodAction.index];
      case MethodActionType.ReturnNew:
        return this.valueToReal(methodAction.value);
      case MethodActionType.ThrowArg:
        throw args[methodAction.index];
      case MethodActionType.ThrowNew:
        throw this.valueToReal(methodAction.value);
    }
  }

  private createMethods(methods: Map<string, MethodInstructions>) {
    for (const [methodName, methodInstructions] of methods) {
      const method = this.executeMethodInstructions.bind(
        this,
        methodName,
        methodInstructions
      );
      this.methods.set(methodName, {
        method,
        boundArgs: methodInstructions.boundArgs,
      });
    }
  }

  public async run(plan: FuzzerPlan) {
    const methods = plan.getMethods();
    const actions = plan.getActions();
    this.createMethods(methods);
    for (const action of actions) {
      switch (action.type) {
        case ActionType.CreateFuture: {
          const promiseWithResolvers = Promise.withResolvers();
          this.promises.set(action.futureId, promiseWithResolvers);
          promiseWithResolvers.promise.catch(() => {});
          break;
        }
        case ActionType.CreateResolvedFuture: {
          const real = this.valueToReal(action.value);
          this.promises.set(action.futureId, {
            promise: Promise.resolve(real),
          });
          break;
        }
        case ActionType.CreateRejectedFuture: {
          const real = this.valueToReal(action.value);
          const promise = Promise.reject(real);
          this.promises.set(action.futureId, { promise });
          promise.catch(() => {});
          break;
        }
        case ActionType.CreateRace: {
          const promise = Promise.race(
            action.futureIds.map((id) => this.promises.get(id)!.promise!)
          );
          this.promises.set(action.futureId, { promise });
          promise.catch(() => {});
          break;
        }
        case ActionType.CreateAll: {
          const promise = Promise.all(
            action.futureIds.map((id) => this.promises.get(id)!.promise!)
          );
          this.promises.set(action.futureId, { promise });
          promise.catch(() => {});
          break;
        }
        case ActionType.CreateAny: {
          const promise = Promise.any(
            action.futureIds.map((id) => this.promises.get(id)!.promise!)
          );
          this.promises.set(action.futureId, { promise });
          promise.catch(() => {});
          break;
        }
        case ActionType.CreateAllSettled: {
          const promise = Promise.allSettled(
            action.futureIds.map((id) => this.promises.get(id)!.promise!)
          );
          this.promises.set(action.futureId, { promise });
          promise.catch(() => {});
          break;
        }
        case ActionType.CreateTryFuture: {
          const { promise, resolve, reject } = Promise.withResolvers();

          try {
            resolve(this.methodNameToMethod(action.methodName)());
          } catch (e) {
            promise.catch(() => {});
            reject(e);
          }
          this.promises.set(action.futureId, {
            promise,
          });
          break;
        }
        case ActionType.WaitMicrotask:
          await Promise.resolve();
          break;
        case ActionType.NewSession:
          // Cycle the event loop so that events don't overlap between sessions.
          for (let i = 0; i < 100; i++) {
            await Promise.resolve();
          }
          this.methods = new Map();
          this.promises = new Map();
          this.objects = new Map();
          this.createMethods(methods);
          break;
        case ActionType.NextFuture: {
          const { promise } = this.promises.get(action.futureId)!;
          const nextPromise = promise!.then(
            this.methodNameToMethod(action.methodName)
          );
          this.promises.set(action.nextFutureId, {
            promise: nextPromise,
          });
          nextPromise.catch(() => {});
          break;
        }
        case ActionType.CatchFuture: {
          const { promise } = this.promises.get(action.futureId)!;
          const nextPromise = promise!.catch(
            this.methodNameToMethod(action.methodName)
          );
          this.promises.set(action.nextFutureId, {
            promise: nextPromise,
          });
          nextPromise.catch(() => {});
          break;
        }
        case ActionType.OnFinallyFuture: {
          const { promise } = this.promises.get(action.futureId)!;
          const nextPromise = promise!.finally(
            this.methodNameToMethod(action.methodName)
          );
          this.promises.set(action.nextFutureId, {
            promise: nextPromise,
          });
          nextPromise.catch(() => {});
          break;
        }
        case ActionType.ResolveFuture: {
          const real = this.valueToReal(action.value);
          const { resolve } = this.promises.get(action.futureId)!;
          resolve!(real);
          break;
        }
        case ActionType.RejectFuture: {
          const real = this.valueToReal(action.value);
          const { promise, reject } = this.promises.get(action.futureId)!;
          promise!.catch(() => {});
          reject!(real);
          break;
        }
      }
    }
    for (let i = 0; i < 100; i++) {
      await Promise.resolve();
    }
  }
}
