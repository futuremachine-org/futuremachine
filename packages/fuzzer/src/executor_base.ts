import type {
  AnyValue,
  FuzzerPlan,
  MethodInstructions,
  PrimitiveRawTypes,
} from './fuzzer_plan.js';
import { ActionType, MethodActionType, ValueTypes } from './fuzzer_plan.js';

export interface TestObject {
  value: number;
}

export interface DeferredResolvers<DeferredType, DeferredId> {
  deferred: DeferredType;
  id: DeferredId;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export interface ExecutorContext<DeferredType, DeferredId> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createMethod<T extends (...args: any[]) => any>(
    methodName: string,
    methodExecutor: T
  ): T;
  build(): void;

  bindArgs<A extends unknown[], B extends unknown[], R>(
    func: (...args: [...A, ...B]) => R,
    ...args: A
  ): (...args: B) => R;

  createTestObject(): TestObject;
  ignoreErrors(deferred: DeferredType): void;
  getDeferredClass(): new (...args: unknown[]) => DeferredType;

  withResolvers(): DeferredResolvers<DeferredType, DeferredId>;
  resolve(value: unknown): DeferredType;
  reject(value: unknown): DeferredType;
  resolveFutureById(id: DeferredId, value: unknown): void;
  rejectFutureById(id: DeferredId, reason: unknown): void;
  race(value: Iterable<unknown>): DeferredType;
  all(value: Iterable<unknown>): DeferredType;
  any(value: Iterable<unknown>): DeferredType;
  allSettled(value: Iterable<unknown>): DeferredType;
  try(func: (...args: unknown[]) => unknown): DeferredType;
  flush(): Promise<void>;

  deferredNext(
    deferred: DeferredType,
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (value: unknown) => unknown
  ): DeferredType;
  deferredCatch(
    deferred: DeferredType,
    onRejected?: (value: unknown) => unknown
  ): DeferredType;
  deferredFinally(deferred: DeferredType, onFinally?: () => void): DeferredType;
}

export interface Executor<
  DeferredType,
  DeferredId,
  Context extends ExecutorContext<DeferredType, DeferredId>,
> {
  createContext(): Context;
}

export class ExecutorBase<
  DeferredType,
  DeferredId,
  Context extends ExecutorContext<DeferredType, DeferredId>,
> {
  private deferreds: Map<
    number,
    Partial<DeferredResolvers<DeferredType, DeferredId>>
  > = new Map();
  private methods: Map<
    string,
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      method: (...args: any[]) => any;
      boundArgs: AnyValue[];
    }
  > = new Map();
  private objects: Map<number, TestObject> = new Map();

  private events: unknown[] = [];

  constructor(private executor: Executor<DeferredType, DeferredId, Context>) {}

  public getEvents(): unknown[] {
    return this.events;
  }

  // TODO: Handle recursion better if we ever
  private createEventObject(context: Context, value: unknown): unknown {
    switch (typeof value) {
      case 'string':
      case 'number':
      case 'boolean':
      case 'undefined':
        return value;
      case 'object':
        if (value === null) {
          return value;
        }
        if (value instanceof context.getDeferredClass()) {
          // TODO: Put the id of the deferred here.
          return { type: 'deferred', id: 'TODO' };
        }
        // TODO: We need to update List so that `for(const prop in list)`
        // doesn't iterate through private properties like the impl. Then we can
        // probably get rid of this special handling for iterables.
        if (
          typeof (value as { [Symbol.iterator]: unknown })[Symbol.iterator] ===
          'function'
        ) {
          const arr = [];
          for (const element of value as unknown[]) {
            arr.push(this.createEventObject(context, element));
          }
          return arr;
        }
        {
          const obj: Record<string, unknown> = {};
          for (const propName in value) {
            const prop = (value as Record<string, unknown>)[propName];
            obj[propName] = this.createEventObject(context, prop);
          }
          return obj;
        }
      case 'function':
        // TODO: Put the name of the function here.
        return { type: 'function', name: 'TODO' };
      case 'symbol':
      case 'bigint':
        throw new Error(`Unsupported arg ${typeof value}`);
    }
  }

  private recordEvent(
    context: Context,
    event: { methodName: string; args: unknown[] }
  ) {
    this.events.push(this.createEventObject(context, event));
  }

  private methodNameToMethod(
    context: Context,
    methodName: string
  ): (...args: unknown[]) => unknown {
    const method = this.methods.get(methodName);
    if (!method) {
      throw new Error('Method not found');
    }
    return context.bindArgs(
      method.method,
      context,
      ...method.boundArgs.map((value: AnyValue) =>
        this.valueToReal(context, value)
      )
    );
  }

  private valueToReal(
    context: Context,
    value: AnyValue
  ):
    | DeferredType
    | ((...args: unknown[]) => unknown)
    | TestObject
    | PrimitiveRawTypes {
    switch (value.type) {
      case ValueTypes.Future: {
        const deferred = this.deferreds.get(value.futureId)?.deferred;
        if (!deferred) {
          throw new Error('Future not found');
        }
        return deferred;
      }
      case ValueTypes.Method:
        return this.methodNameToMethod(context, value.methodName);
      case ValueTypes.Obj: {
        let obj = this.objects.get(value.objectId);
        if (!obj) {
          obj = context.createTestObject();
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
    context: Context,
    ...args: unknown[]
  ) {
    const { methodAction, modifyObjects } = instructions;
    this.recordEvent(context, {
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
        return this.valueToReal(context, methodAction.value);
      case MethodActionType.ThrowArg:
        throw args[methodAction.index];
      case MethodActionType.ThrowNew:
        throw this.valueToReal(context, methodAction.value);
    }
  }

  private createMethods(methods: Map<string, MethodInstructions>): Context {
    const context = this.executor.createContext();
    for (const [methodName, methodInstructions] of methods) {
      const method = context.createMethod(
        methodName,
        this.executeMethodInstructions.bind(
          this,
          methodName,
          methodInstructions
        )
      );
      this.methods.set(methodName, {
        method,
        boundArgs: methodInstructions.boundArgs,
      });
    }
    context.build();

    return context;
  }

  public async run(plan: FuzzerPlan) {
    const methods = plan.getMethods();
    const actions = plan.getActions();

    let context = this.createMethods(methods);
    for (const action of actions) {
      switch (action.type) {
        case ActionType.CreateFuture: {
          const deferredWithResolvers = context.withResolvers();
          this.deferreds.set(action.futureId, deferredWithResolvers);
          context.ignoreErrors(deferredWithResolvers.deferred);
          break;
        }
        case ActionType.CreateResolvedFuture: {
          const real = this.valueToReal(context, action.value);
          this.deferreds.set(action.futureId, {
            deferred: context.resolve(real),
          });
          break;
        }
        case ActionType.CreateRejectedFuture: {
          const real = this.valueToReal(context, action.value);
          const deferred = context.reject(real);
          this.deferreds.set(action.futureId, { deferred });
          context.ignoreErrors(deferred);
          break;
        }
        case ActionType.CreateRace: {
          const deferred = context.race(
            action.futureIds.map((id) => this.deferreds.get(id)!.deferred!)
          );
          this.deferreds.set(action.futureId, { deferred });
          context.ignoreErrors(deferred);
          break;
        }
        case ActionType.CreateAll: {
          const deferred = context.all(
            action.futureIds.map((id) => this.deferreds.get(id)!.deferred!)
          );
          this.deferreds.set(action.futureId, { deferred });
          context.ignoreErrors(deferred);
          break;
        }
        case ActionType.CreateAny: {
          const deferred = context.any(
            action.futureIds.map((id) => this.deferreds.get(id)!.deferred!)
          );
          this.deferreds.set(action.futureId, { deferred });
          context.ignoreErrors(deferred);
          break;
        }
        case ActionType.CreateAllSettled: {
          const deferred = context.allSettled(
            action.futureIds.map((id) => this.deferreds.get(id)!.deferred!)
          );
          this.deferreds.set(action.futureId, { deferred });
          context.ignoreErrors(deferred);
          break;
        }
        case ActionType.CreateTryFuture: {
          const deferred = context.try(
            this.methodNameToMethod(context, action.methodName)
          );
          this.deferreds.set(action.futureId, {
            deferred,
          });
          break;
        }
        case ActionType.WaitMicrotask:
          await Promise.resolve();
          break;
        case ActionType.NewSession:
          await context.flush();
          this.methods = new Map();
          this.deferreds = new Map();
          this.objects = new Map();
          context = this.createMethods(methods);
          break;
        case ActionType.NextFuture: {
          const { deferred } = this.deferreds.get(action.futureId)!;
          const nextDeferred = context.deferredNext(
            deferred!,
            this.methodNameToMethod(context, action.methodName)
          );
          this.deferreds.set(action.nextFutureId, {
            deferred: nextDeferred,
          });
          context.ignoreErrors(nextDeferred);
          break;
        }
        case ActionType.CatchFuture: {
          const { deferred } = this.deferreds.get(action.futureId)!;
          const nextDeferred = context.deferredCatch(
            deferred!,
            this.methodNameToMethod(context, action.methodName)
          );
          this.deferreds.set(action.nextFutureId, {
            deferred: nextDeferred,
          });
          context.ignoreErrors(nextDeferred);
          break;
        }
        case ActionType.OnFinallyFuture: {
          const { deferred } = this.deferreds.get(action.futureId)!;
          const nextDeferred = context.deferredFinally(
            deferred!,
            this.methodNameToMethod(context, action.methodName)
          );
          this.deferreds.set(action.nextFutureId, {
            deferred: nextDeferred,
          });
          context.ignoreErrors(nextDeferred);
          break;
        }
        case ActionType.ResolveFuture: {
          const real = this.valueToReal(context, action.value);
          const { id } = this.deferreds.get(action.futureId)!;
          context.resolveFutureById(id!, real);
          break;
        }
        case ActionType.RejectFuture: {
          const real = this.valueToReal(context, action.value);
          const { deferred, id } = this.deferreds.get(action.futureId)!;
          context.ignoreErrors(deferred!);
          context.rejectFutureById(id!, real);
          break;
        }
      }
    }
    await context.flush();
  }
}
