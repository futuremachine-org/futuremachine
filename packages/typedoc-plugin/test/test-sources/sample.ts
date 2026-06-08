import type {
  List,
  Method,
  Struct as Something,
  Struct,
} from '@futuremachine/core';

export type TestStruct = Struct<{
  func1: Method<(data: number) => void>;
  func2: Method<(id: string) => void>;
  version: number;
}>;

export type TestAlias = Something<{
  func1: Method<(data: number) => void>;
  func2: Method<(id: string) => void>;
  version: number;
}>;

export type TestObject = {
  func1: Method<(data: number) => void>;
  func2: Method<(id: string) => void>;
  version: number;
};

export type TestVanillaObject = {
  create: (data: number) => void;
  delete: (id: string) => void;
  version: number;
};

export type TestTypeWithArguments<T> = { a: T };

export type TestWrappedVanillaObject = TestTypeWithArguments<{
  create: (data: number) => void;
  delete: (id: string) => void;
  version: number;
}>;

export type TestList = List<number[]>;
