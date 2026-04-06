import type { RandomGenerator } from './rand_gen_xorshift.js';

export enum ActionType {
  CreateFuture,
  CreateResolvedFuture,
  CreateRejectedFuture,
  CreateRace,
  CreateAll,
  CreateAny,
  CreateAllSettled,
  CreateTryFuture,
  WaitMicrotask,
  NextFuture,
  CatchFuture,
  OnFinallyFuture,
  ResolveFuture,
  RejectFuture,
  NewSession,
}

export type CreateFutureAction = {
  type: ActionType.CreateFuture;
  futureId: number;
};

export type CreateSettledAction = {
  type: ActionType.CreateResolvedFuture | ActionType.CreateRejectedFuture;
  futureId: number;
  value: AnyValue;
};

export type CreateAggregateAction = {
  type:
    | ActionType.CreateRace
    | ActionType.CreateAll
    | ActionType.CreateAny
    | ActionType.CreateAllSettled;
  futureId: number;
  futureIds: number[];
};

export type CreateTryFutureAction = {
  type: ActionType.CreateTryFuture;
  futureId: number;
  methodName: string;
};

export type ReactionAction = {
  type:
    | ActionType.NextFuture
    | ActionType.CatchFuture
    | ActionType.OnFinallyFuture;
  futureId: number;
  methodName: string;
  nextFutureId: number;
};

export type SettleAction = {
  type: ActionType.ResolveFuture | ActionType.RejectFuture;
  futureId: number;
  value: AnyValue;
};

export type WaitMicrotaskAction = {
  type: ActionType.WaitMicrotask;
};

export type NewSessionAction = {
  type: ActionType.NewSession;
};

export type Action =
  | CreateFutureAction
  | CreateSettledAction
  | CreateAggregateAction
  | CreateTryFutureAction
  | ReactionAction
  | SettleAction
  | NewSessionAction
  | WaitMicrotaskAction;

export enum ValueTypes {
  Primitive,
  Obj,
  Method,
  Future,
}

// TODO: Add bigint
export type PrimitiveRawTypes = boolean | number | string | undefined | null;

export type PrimitiveValue = {
  type: ValueTypes.Primitive;
  value: PrimitiveRawTypes;
};

export type ObjectValue = {
  type: ValueTypes.Obj;
  objectId: number;
};

export type MethodValue = {
  type: ValueTypes.Method;
  methodName: string;
};

export type FutureValue = {
  type: ValueTypes.Future;
  futureId: number;
};

export type AnyValue = PrimitiveValue | ObjectValue | MethodValue | FutureValue;

export enum MethodActionType {
  ThrowArg,
  ThrowNew,
  ReturnArg,
  ReturnNew,
}

export type MethodAction =
  | {
      type: MethodActionType.ThrowArg;
      index: number;
    }
  | {
      type: MethodActionType.ThrowNew;
      value: AnyValue;
    }
  | {
      type: MethodActionType.ReturnArg;
      index: number;
    }
  | {
      type: MethodActionType.ReturnNew;
      value: AnyValue;
    };

type ModifyObject = {
  argIndex: number;
  value: number;
};

export type MethodInstructions = {
  boundArgs: AnyValue[];
  modifyObjects: ModifyObject[];
  hasResult: boolean;
  methodAction: MethodAction;
};

const MaxRecursiveBindDepth = 5;

function randomSelect<T>(randGen: RandomGenerator, arr: T[]): T {
  if (arr.length === 0) {
    throw new Error("Can't select from empty array.");
  }
  return arr[Math.floor(randGen.random() * arr.length)]!;
}

function randomBoolean(randGen: RandomGenerator): boolean {
  return randGen.random() > 0.5;
}

// Returns random integer between min inclusive and max exclusive.
function randomInt(randGen: RandomGenerator, min: number, max: number): number {
  return Math.floor(randGen.random() * (max - min)) + min;
}

function randomSubset<T>(randGen: RandomGenerator, arr: Iterable<T>): T[] {
  const arrCopy: T[] = [...arr];
  const subsetSize = randomInt(randGen, 1, arrCopy.length);
  const subset: T[] = [];
  for (let i = 0; i < subsetSize; i++) {
    subset.push(randomTake(randGen, arrCopy));
  }
  return subset;
}

function randomTake<T>(randGen: RandomGenerator, arr: T[]): T {
  if (arr.length === 0) {
    throw new Error("Can't select from empty array.");
  }
  return arr.splice(randomInt(randGen, 0, arr.length), 1)[0]!;
}

export class FuzzerPlan {
  private idCount: number = 0;
  private futureIds: Map<
    number,
    {
      settled: boolean;
    }
  > = new Map();
  private objectIds: number[] = [];
  private methods: Map<string, MethodInstructions> = new Map();
  private actions: Action[] = [];

  constructor(
    private randGen: RandomGenerator,
    size: number
  ) {
    for (let i = 0; i < size; i++) {
      const actionTypes: ActionType[] = [
        ActionType.CreateFuture,
        ActionType.CreateResolvedFuture,
        ActionType.CreateRejectedFuture,
        ActionType.CreateRace,
        ActionType.CreateAll,
        ActionType.CreateAny,
        ActionType.CreateAllSettled,
        ActionType.CreateTryFuture,
        ActionType.WaitMicrotask,
        ActionType.NextFuture,
        ActionType.CatchFuture,
        ActionType.OnFinallyFuture,
        ActionType.ResolveFuture,
        ActionType.RejectFuture,
        ActionType.NewSession,
      ];
      while (actionTypes.length > 0) {
        const actionType = randomTake(this.randGen, actionTypes);
        const action = this[actionType]();
        if (action) {
          this.actions.push(action);
          break;
        }
      }
    }
  }

  public getMethods() {
    return this.methods;
  }
  public getActions() {
    return this.actions;
  }

  private [ActionType.CreateFuture](): CreateFutureAction {
    return this.createFutureImpl(ActionType.CreateFuture);
  }
  private [ActionType.CreateResolvedFuture](): CreateSettledAction {
    return this.createSettledFutureImpl(ActionType.CreateResolvedFuture);
  }
  private [ActionType.CreateRejectedFuture](): CreateSettledAction {
    return this.createSettledFutureImpl(ActionType.CreateRejectedFuture);
  }
  private [ActionType.CreateRace](): CreateAggregateAction | undefined {
    return this.createAggregateFutureImpl(ActionType.CreateRace);
  }
  private [ActionType.CreateAll](): CreateAggregateAction | undefined {
    return this.createAggregateFutureImpl(ActionType.CreateAll);
  }
  private [ActionType.CreateAny](): CreateAggregateAction | undefined {
    return this.createAggregateFutureImpl(ActionType.CreateAny);
  }
  private [ActionType.CreateAllSettled](): CreateAggregateAction | undefined {
    return this.createAggregateFutureImpl(ActionType.CreateAllSettled);
  }

  private [ActionType.CreateTryFuture](): CreateTryFutureAction {
    const methodName = this.createMethodImpl();
    const futureId = this.createId();
    this.futureIds.set(futureId, { settled: true });
    return {
      type: ActionType.CreateTryFuture,
      futureId,
      methodName,
    };
  }
  private [ActionType.WaitMicrotask](): Action {
    return { type: ActionType.WaitMicrotask };
  }
  private [ActionType.NewSession](): NewSessionAction {
    this.futureIds = new Map();
    this.objectIds = [];
    return { type: ActionType.NewSession };
  }
  private [ActionType.NextFuture](): ReactionAction | undefined {
    return this.createReactionImpl(ActionType.NextFuture);
  }
  private [ActionType.CatchFuture](): ReactionAction | undefined {
    return this.createReactionImpl(ActionType.CatchFuture);
  }
  private [ActionType.OnFinallyFuture](): ReactionAction | undefined {
    return this.createReactionImpl(ActionType.OnFinallyFuture);
  }
  private [ActionType.ResolveFuture](): SettleAction | undefined {
    return this.settleReactionImpl(ActionType.ResolveFuture);
  }
  private [ActionType.RejectFuture](): SettleAction | undefined {
    return this.settleReactionImpl(ActionType.RejectFuture);
  }

  private createFutureImpl(type: ActionType.CreateFuture): CreateFutureAction {
    const futureId = this.createId();
    this.futureIds.set(futureId, { settled: false });
    return { type, futureId };
  }

  private createSettledFutureImpl(
    type: ActionType.CreateResolvedFuture | ActionType.CreateRejectedFuture
  ): CreateSettledAction {
    const value = this.createRandomArg(0);
    const futureId = this.createId();
    this.futureIds.set(futureId, { settled: true });
    return { type, futureId, value };
  }

  private createReactionImpl(
    type:
      | ActionType.NextFuture
      | ActionType.CatchFuture
      | ActionType.OnFinallyFuture
  ): ReactionAction | undefined {
    if (this.futureIds.size === 0) {
      return undefined;
    }
    const futureId = randomSelect(this.randGen, [...this.futureIds.keys()]);
    const methodName = this.createMethodImpl(0, /*hasResult=*/ true);
    const nextFutureId = this.createId();
    this.futureIds.set(nextFutureId, { settled: true });
    return { type, futureId, methodName, nextFutureId };
  }

  private settleReactionImpl(
    type: ActionType.ResolveFuture | ActionType.RejectFuture
  ): SettleAction | undefined {
    const unsettledFutures = [...this.futureIds.entries()].filter(
      ([_, { settled }]) => {
        return !settled;
      }
    );
    if (unsettledFutures.length === 0) {
      return undefined;
    }
    const [futureId, state] = randomSelect(this.randGen, unsettledFutures);
    state.settled = true;
    return { type, futureId, value: this.createRandomArg(0, futureId) };
  }

  private createAggregateFutureImpl(
    type:
      | ActionType.CreateRace
      | ActionType.CreateAll
      | ActionType.CreateAny
      | ActionType.CreateAllSettled
  ): CreateAggregateAction | undefined {
    if (this.futureIds.size === 0) {
      return;
    }
    const raceFutureIds = randomSubset(this.randGen, this.futureIds.keys());
    const futureId = this.createId();
    this.futureIds.set(futureId, { settled: true });
    return {
      type,
      futureId,
      futureIds: raceFutureIds,
    };
  }

  private createId(): number {
    return this.idCount++;
  }

  private createMethodName(): string {
    return `method${this.createId()}`;
  }

  private createRandomArg(
    recursionDepth: number,
    excludedFutureId?: number
  ): AnyValue {
    const argTypes: (() => AnyValue)[] = [
      this.createPrimitiveArg.bind(this),
      this.createObjectArg.bind(this),
    ];
    if (recursionDepth < MaxRecursiveBindDepth) {
      argTypes.push(this.createMethodArg.bind(this, recursionDepth + 1));
    }
    if (
      this.futureIds.size > 0 &&
      (excludedFutureId === undefined || this.futureIds.size > 1)
    ) {
      argTypes.push(this.createFutureArg.bind(this, excludedFutureId));
    }
    return randomSelect(this.randGen, argTypes)();
  }

  private createPrimitiveArg(): PrimitiveValue {
    const value: PrimitiveRawTypes = randomSelect(this.randGen, [
      () => randomBoolean(this.randGen),
      () => randomInt(this.randGen, 0, 1000),
      () => randomInt(this.randGen, 0, 1000).toString(),
      () => undefined,
      () => null,
    ])();

    return {
      type: ValueTypes.Primitive,
      value,
    };
  }

  private createObjectArg(): ObjectValue {
    const newObject =
      this.objectIds.length === 0 || randomBoolean(this.randGen);
    if (newObject) {
      const objectId = this.createId();
      this.objectIds.push(objectId);
      return {
        type: ValueTypes.Obj,
        objectId,
      };
    }
    const objectId = randomSelect(this.randGen, this.objectIds);
    return {
      type: ValueTypes.Obj,
      objectId,
    };
  }

  private createMethodArg(recursionDepth: number): MethodValue {
    return {
      type: ValueTypes.Method,
      methodName: this.createMethodImpl(recursionDepth + 1),
    };
  }

  private createFutureArg(excludedFutureId?: number): FutureValue {
    return {
      type: ValueTypes.Future,
      futureId: randomSelect(this.randGen, [
        ...this.futureIds.keys().filter((futureId) => {
          return futureId !== excludedFutureId;
        }),
      ]),
    };
  }

  private createMethodImpl(
    recursionDepth: number = 0,
    hasResult: boolean = false
  ): string {
    const argCount = Math.floor(this.randGen.random() * 5);
    const boundArgs: AnyValue[] = [];
    const modifyObjects: ModifyObject[] = [];
    for (let i = 0; i < argCount; i++) {
      const arg = this.createRandomArg(recursionDepth + 1);
      boundArgs.push(arg);
      if (arg.type === ValueTypes.Obj) {
        modifyObjects.push({ argIndex: i, value: this.createId() });
      }
    }
    const possibleMethodActions: (() => MethodAction)[] = [
      (): { type: MethodActionType.ThrowNew; value: AnyValue } => {
        return {
          type: MethodActionType.ThrowNew,
          value: this.createPrimitiveArg(),
        };
      },
      (): { type: MethodActionType.ReturnNew; value: AnyValue } => {
        return {
          type: MethodActionType.ReturnNew,
          value: this.createPrimitiveArg(),
        };
      },
    ];

    if (argCount > 0 || hasResult) {
      possibleMethodActions.push(
        (): { type: MethodActionType.ThrowArg; index: number } => {
          return {
            type: MethodActionType.ThrowArg,
            index: randomInt(this.randGen, 0, argCount + (hasResult ? 1 : 0)),
          };
        },
        (): { type: MethodActionType.ReturnArg; index: number } => {
          return {
            type: MethodActionType.ReturnArg,
            index: randomInt(this.randGen, 0, argCount + (hasResult ? 1 : 0)),
          };
        }
        // TODO: The other MethodActionTypes
      );
    }
    const methodAction: MethodAction = randomSelect(
      this.randGen,
      possibleMethodActions
    )();
    const name = this.createMethodName();
    this.methods.set(name, {
      boundArgs,
      modifyObjects,
      methodAction,
      hasResult,
    });

    return name;
  }
}
