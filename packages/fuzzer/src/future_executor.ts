import {
  createMethodMachine,
  Future,
  SimpleFutureDatabase,
  type Containers,
  type Dictionary,
  type FutureId,
  type FutureMachine,
  type Method,
  type RejectCallback,
  type ResolveCallback,
  type Serializable,
} from '@futuremachine/core';
import {
  ActionType,
  FuzzerPlan,
  MethodActionType,
  ValueTypes,
  type AnyValue,
  type MethodInstructions,
  type PrimitiveRawTypes,
} from './fuzzer_plan.js';

export class FutureExecutor {
  private futures: Map<
    number,
    Partial<{
      future: Future<Serializable>;
      id: FutureId<Serializable>;
      resolve: ResolveCallback<Serializable>;
      reject: RejectCallback;
    }>
  > = new Map();
  private methods: Map<
    string,
    {
      method: Method<(...args: Serializable[]) => Serializable>;
      boundArgs: AnyValue[];
    }
  > = new Map();
  private objects: Map<number, Dictionary<number>> = new Map();

  private events: unknown[] = [];

  public getEvents(): unknown[] {
    return this.events;
  }

  private recordEvent(event: { methodName: string; args: Serializable[] }) {
    this.events.push(structuredClone(event));
  }

  private methodNameToMethod(
    futureMachine: FutureMachine,
    containers: Containers,
    methodName: string
  ): Method<(...args: Serializable[]) => Serializable> {
    const method = this.methods.get(methodName);
    if (!method) {
      throw new Error('Method not found');
    }
    return method.method.bindArgs(
      futureMachine,
      ...method.boundArgs.map((value: AnyValue) =>
        this.valueToReal(futureMachine, containers, value)
      )
    );
  }

  private argToString(
    value: AnyValue | undefined,
    index: number,
    boundArgsLength: number
  ): [string, string] {
    if (index === boundArgsLength) {
      return [`result`, `any`];
    }
    if (value === undefined) {
      throw new Error('value is undefined');
    }
    switch (value.type) {
      case ValueTypes.Primitive:
        return [`primitive${index}`, `${typeof value.value}`];
      case ValueTypes.Obj:
        return [`obj${index}`, `TestObject`];
      case ValueTypes.Method:
        return [`method${index}`, `Method<(...args: any[]) => Serializable>`];
      case ValueTypes.Future:
        return [`future${index}`, `Future<any>`];
    }
  }

  private valueToReal(
    futureMachine: FutureMachine,
    containers: Containers,
    value: AnyValue
  ):
    | Future<Serializable>
    | Method<(...args: Serializable[]) => Serializable>
    | Dictionary<number>
    | PrimitiveRawTypes {
    switch (value.type) {
      case ValueTypes.Future: {
        const future = this.futures.get(value.futureId)?.future;
        if (!future) {
          throw new Error('Future not found');
        }
        return future;
      }
      case ValueTypes.Method:
        return this.methodNameToMethod(
          futureMachine,
          containers,
          value.methodName
        );
      case ValueTypes.Obj: {
        let obj = this.objects.get(value.objectId);
        if (!obj) {
          obj = containers.createDictionary<number>();
          obj.set('value', 0);
          this.objects.set(value.objectId, obj);
          console.log(`const obj${value.objectId} = new TestObject();`);
        }
        return obj;
      }
      case ValueTypes.Primitive:
        return value.value;
    }
  }

  private valueToString(value: AnyValue): string {
    switch (value.type) {
      case ValueTypes.Future:
        return `future${value.futureId}`;
      case ValueTypes.Method:
        return this.methodNameToBoundString(value.methodName);
      case ValueTypes.Obj:
        return `obj${value.objectId}`;
      case ValueTypes.Primitive:
        return `${value.value}`;
    }
  }

  private methodNameToBoundString(methodName: string): string {
    const boundString = this.methods
      .get(methodName)!
      .boundArgs.map((value: AnyValue) => this.valueToString(value))
      .join(', ');
    return `${methodName}.bind(${boundString})`;
  }

  private executeMethodInstructions(
    methodName: string,
    instructions: MethodInstructions,
    containers: Containers,
    futureMachine: FutureMachine,
    ...args: Serializable[]
  ) {
    const { methodAction, modifyObjects } = instructions;
    this.recordEvent({
      methodName,
      args,
    });
    for (const { argIndex, value } of modifyObjects) {
      const obj = args[argIndex] as Dictionary<number>;
      obj.set('value', value);
    }
    switch (methodAction.type) {
      case MethodActionType.ReturnArg:
        return args[methodAction.index];
      case MethodActionType.ReturnNew:
        return this.valueToReal(futureMachine, containers, methodAction.value);
      case MethodActionType.ThrowArg:
        throw args[methodAction.index];
      case MethodActionType.ThrowNew:
        throw this.valueToReal(futureMachine, containers, methodAction.value);
    }
  }

  private writeMethods(methods: Map<string, MethodInstructions>) {
    console.log(`function getMethods(futureDatabase: SimpleFutureDatabase) {`);
    console.log(`const methodMachine = createMethodMachine(futureDatabase);`);

    const exports: string[] = [];

    for (const [methodName, methodInstructions] of methods) {
      const argsStrings = methodInstructions.boundArgs.map(
        (value: AnyValue, index: number) => {
          return this.argToString(
            value,
            index,
            methodInstructions.boundArgs.length
          ).join(': ');
        }
      );
      argsStrings.push(
        this.argToString(
          undefined,
          methodInstructions.boundArgs.length,
          methodInstructions.boundArgs.length
        ).join(': ')
      );
      const argsString = argsStrings.join(', ');
      const bodyString = (() => {
        switch (methodInstructions.methodAction.type) {
          case MethodActionType.ReturnArg: {
            const { index } = methodInstructions.methodAction;
            const value = methodInstructions.boundArgs[index];
            return `return ${this.argToString(value, index, methodInstructions.boundArgs.length)[0]};`;
          }
          case MethodActionType.ReturnNew: {
            return `return ${this.valueToString(methodInstructions.methodAction.value)};`;
          }
          case MethodActionType.ThrowArg: {
            const { index } = methodInstructions.methodAction;
            const value = methodInstructions.boundArgs[index];
            return `throw ${this.argToString(value, index, methodInstructions.boundArgs.length)[0]};`;
          }
          case MethodActionType.ThrowNew: {
            return `throw ${this.valueToString(methodInstructions.methodAction.value)};`;
          }
        }
      })();
      exports.push(methodName);
      console.log(
        `const ${methodName} = methodMachine.create("${methodName}", (${argsString}) =>{\n` +
          `  ${bodyString}\n` +
          `});`
      );
    }

    console.log(`const futureMachine = methodMachine.build();`);
    exports.push('futureMachine');
    const getMethodsReturn = `{${exports.join(', ')}}`;
    console.log(`return ${getMethodsReturn}`);
    console.log(`}`);
    return getMethodsReturn;
  }

  private createMethods(
    futureDatabase: SimpleFutureDatabase,
    methods: Map<string, MethodInstructions>
  ) {
    const methodMachine = createMethodMachine(futureDatabase);

    for (const [methodName, methodInstructions] of methods) {
      const method = methodMachine.methods.create(
        methodName,
        this.executeMethodInstructions.bind(
          this,
          methodName,
          methodInstructions,
          methodMachine.containers
        )
      ) as Method<(...args: Serializable[]) => Serializable>;
      this.methods.set(methodName, {
        method,
        boundArgs: methodInstructions.boundArgs,
      });
    }

    return methodMachine;
  }

  public async run(plan: FuzzerPlan) {
    const methods = plan.getMethods();
    const actions = plan.getActions();
    const getMethodsReturn = this.writeMethods(methods);
    console.log(`const futureDatabase = new SimpleFutureDatabase();`);
    const futureDatabase = new SimpleFutureDatabase();
    const callGetMethods = `const ${getMethodsReturn} = getMethods(futureDatabase)`;
    console.log('{');
    console.log(callGetMethods);
    let methodMachine = this.createMethods(futureDatabase, methods);
    let futureMachine = methodMachine.methods.build();
    for (const action of actions) {
      switch (action.type) {
        case ActionType.CreateFuture:
          console.log(
            `const {future: future${action.futureId}, id: futureId${action.futureId}} = futureMachine.withResolvers<any>();`
          );
          this.futures.set(action.futureId, futureMachine.withResolvers());
          break;
        case ActionType.CreateResolvedFuture: {
          const real = this.valueToReal(
            futureMachine,
            methodMachine.containers,
            action.value
          );
          console.log(
            `const future${action.futureId} = futureMachine.resolve(${this.valueToString(action.value)});`
          );
          this.futures.set(action.futureId, {
            future: futureMachine.resolve(real),
          });
          break;
        }
        case ActionType.CreateRejectedFuture: {
          const real = this.valueToReal(
            futureMachine,
            methodMachine.containers,
            action.value
          );
          console.log(
            `const future${action.futureId} = futureMachine.reject(${this.valueToString(action.value)});`
          );
          this.futures.set(action.futureId, {
            future: futureMachine.reject(real),
          });
          break;
        }
        case ActionType.CreateRace: {
          const raceFuturesString = action.futureIds
            .map((id) => `future${id}`)
            .join(', ');
          console.log(
            `const future${action.futureId} = futureMachine.race(${raceFuturesString})`
          );
          const future = futureMachine.race(
            action.futureIds.map((id) => this.futures.get(id)!.future!)
          ) as Future<Serializable>;
          this.futures.set(action.futureId, { future });
          break;
        }
        case ActionType.CreateAll: {
          const allFuturesString = action.futureIds
            .map((id) => `future${id}`)
            .join(', ');
          console.log(
            `const future${action.futureId} = futureMachine.all(${allFuturesString})`
          );
          const future = futureMachine.all(
            action.futureIds.map((id) => this.futures.get(id)!.future!)
          ) as Future<Serializable>;
          this.futures.set(action.futureId, { future });
          break;
        }
        case ActionType.CreateAny: {
          const anyFuturesString = action.futureIds
            .map((id) => `future${id}`)
            .join(', ');
          console.log(
            `const future${action.futureId} = futureMachine.any(${anyFuturesString})`
          );
          const future = futureMachine.any(
            action.futureIds.map((id) => this.futures.get(id)!.future!)
          );
          this.futures.set(action.futureId, { future });
          break;
        }
        case ActionType.CreateAllSettled: {
          const allSettledFuturesString = action.futureIds
            .map((id) => `future${id}`)
            .join(', ');
          console.log(
            `const future${action.futureId} = futureMachine.allSettled(${allSettledFuturesString})`
          );
          const future = futureMachine.allSettled(
            action.futureIds.map((id) => this.futures.get(id)!.future!)
          ) as Future<Serializable>;
          this.futures.set(action.futureId, { future });
          break;
        }
        case ActionType.CreateTryFuture: {
          const boundString = this.methodNameToBoundString(action.methodName);
          console.log(
            `const future${action.futureId} = futureMachine.try(${boundString});`
          );
          const future = futureMachine.try(
            this.methodNameToMethod(
              futureMachine,
              methodMachine.containers,
              action.methodName
            )
          );
          this.futures.set(action.futureId, {
            future,
          });
          break;
        }
        case ActionType.WaitMicrotask:
          console.log(`await Promise.resolve();`);
          await Promise.resolve();
          break;
        case ActionType.NewSession:
          console.log(`}\n{`);
          await futureDatabase.flush();
          this.methods = new Map();
          this.futures = new Map();
          this.objects = new Map();
          console.log(callGetMethods);
          methodMachine = this.createMethods(futureDatabase, methods);
          futureMachine = methodMachine.methods.build();
          break;
        case ActionType.NextFuture: {
          const boundString = this.methodNameToBoundString(action.methodName);
          console.log(
            `const future${action.nextFutureId} = future${action.futureId}.next(${boundString});`
          );
          const { future } = this.futures.get(action.futureId)!;
          const nextFuture = future!.next(
            this.methodNameToMethod(
              futureMachine,
              methodMachine.containers,
              action.methodName
            )
          );
          this.futures.set(action.nextFutureId, {
            future: nextFuture,
          });
          break;
        }
        case ActionType.CatchFuture: {
          const boundString = this.methodNameToBoundString(action.methodName);
          console.log(
            `const future${action.nextFutureId} = future${action.futureId}.catch(${boundString});`
          );
          const { future } = this.futures.get(action.futureId)!;
          const nextFuture = future!.catch(
            this.methodNameToMethod(
              futureMachine,
              methodMachine.containers,
              action.methodName
            )
          );
          this.futures.set(action.nextFutureId, {
            future: nextFuture,
          });
          break;
        }
        case ActionType.OnFinallyFuture: {
          const boundString = this.methodNameToBoundString(action.methodName);
          console.log(
            `const future${action.nextFutureId} = future${action.futureId}.finally(${boundString});`
          );
          const { future } = this.futures.get(action.futureId)!;
          const nextFuture = future!.finally(
            this.methodNameToMethod(
              futureMachine,
              methodMachine.containers,
              action.methodName
            )
          );
          this.futures.set(action.nextFutureId, {
            future: nextFuture,
          });
          break;
        }
        case ActionType.ResolveFuture: {
          const real = this.valueToReal(
            futureMachine,
            methodMachine.containers,
            action.value
          );
          console.log(
            `futureMachine.resolveFutureById(futureId${action.futureId}, ${this.valueToString(action.value)});`
          );
          const { id } = this.futures.get(action.futureId)!;
          futureMachine.resolveFutureById(id!, real);
          break;
        }
        case ActionType.RejectFuture: {
          const real = this.valueToReal(
            futureMachine,
            methodMachine.containers,
            action.value
          );
          console.log(
            `futureMachine.rejectFutureById(futureId${action.futureId}, ${this.valueToString(action.value)});`
          );
          const { id } = this.futures.get(action.futureId)!;
          futureMachine.rejectFutureById(id!, real);
          break;
        }
      }
    }
    console.log('}');
    await futureDatabase.flush();
  }
}
