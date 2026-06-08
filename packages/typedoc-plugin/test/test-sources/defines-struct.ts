export type Struct<T> = {
  value: T;
};
export type TestNonCoreStruct = Struct<{
  create: (data: number) => void;
  delete: (id: string) => void;
  version: number;
}>;
