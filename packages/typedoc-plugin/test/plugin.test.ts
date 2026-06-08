// plugin.test.ts
import { strict as assert } from 'node:assert';
import * as path from 'node:path';
import { before, describe, test } from 'node:test';
import type { Comment, ProjectReflection } from 'typedoc';
import {
  Application,
  ReferenceType,
  ReflectionKind,
  ReflectionType,
  type DeclarationReflection,
} from 'typedoc';
import { load as loadPlugin } from '../src/index.js';

const packageRoot = process.cwd();
const testSource = path.join(packageRoot, 'test/test-sources');
const sampleTestSource = path.join(testSource, 'sample.ts');
const definesStructTestSource = path.join(testSource, 'defines-struct.ts');
const tsconfig = path.join(packageRoot, 'tsconfig.json');

async function getProject(
  source: string,
  plugins: ((app: Application) => void)[]
): Promise<ProjectReflection> {
  const app = await Application.bootstrap({
    entryPoints: [source],
    tsconfig,
    plugin: [],
  });
  for (const plugin of plugins) {
    plugin(app);
  }
  const project = await app.convert();
  return project!;
}

function getDeclaration(
  project: ProjectReflection,
  targetName: string
): DeclarationReflection {
  return project.getChildByName(targetName) as DeclarationReflection;
}

function cleanIds(json: object) {
  const cleanedObj: { [s: string]: unknown } = {};
  for (const [key, value] of Object.entries(json)) {
    if (key === 'id') {
      continue;
    }
    if (value !== null && typeof value === 'object') {
      cleanedObj[key] = cleanIds(value);
    } else {
      cleanedObj[key] = value;
    }
  }

  return cleanedObj;
}

function getFirstTypeArg(struct: DeclarationReflection): ReflectionType {
  const baselineType = struct.type;
  assert.ok(baselineType instanceof ReferenceType);

  const structTypeArgument = baselineType.typeArguments![0];
  assert.ok(structTypeArgument instanceof ReflectionType);

  return structTypeArgument;
}

function* iterateChildren(
  pluginStruct: DeclarationReflection,
  childNames: string[]
): Generator<DeclarationReflection> {
  for (const childName of childNames) {
    yield pluginStruct.children!.find((child) => child.name === childName)!;
  }
}

function isUnwrappedStruct(
  baselineStruct: DeclarationReflection,
  pluginStruct: DeclarationReflection
) {
  const baselineStructTypeArg = getFirstTypeArg(baselineStruct).declaration;

  // Should have erased the type so that it's treated as an object.
  assert.strictEqual(pluginStruct.type, undefined);

  // The children from the type should've moved to direct children.
  assert.notStrictEqual(pluginStruct.children, undefined);
  assert.strictEqual(
    pluginStruct.children!.length,
    baselineStructTypeArg.children!.length
  );
  for (let i = 0; i < baselineStructTypeArg.children!.length; i++) {
    assert.strictEqual(
      pluginStruct.children![i]!.name,
      baselineStructTypeArg.children![i]!.name
    );
  }

  // Children should also be added to the Properties group.
  assert.notStrictEqual(pluginStruct.groups, undefined);
  const propertiesGroup = pluginStruct.groups![0]!;
  assert.strictEqual(propertiesGroup.title, 'Properties');
  for (let i = 0; i < baselineStructTypeArg.children!.length; i++) {
    assert.strictEqual(
      propertiesGroup.children![i]!.name,
      baselineStructTypeArg.children![i]!.name
    );
  }
}

function methodsAreUnwrapped(
  baselineStruct: DeclarationReflection,
  pluginStruct: DeclarationReflection,
  funcNames: string[]
) {
  for (const baselineFunc of iterateChildren(baselineStruct, funcNames)) {
    assert.notStrictEqual(baselineFunc, undefined);
    const pluginFunc = pluginStruct.children!.find(
      (child) => child.name === baselineFunc!.name
    );
    assert.notStrictEqual(pluginFunc, undefined);

    assert.strictEqual(pluginFunc!.kind, ReflectionKind.Property);

    assert.deepStrictEqual(
      cleanIds(getFirstTypeArg(baselineFunc!)),
      cleanIds(pluginFunc!.type!)
    );
  }
}

function hasNotice(comment: Comment, type: string) {
  const summary = comment.summary[0]!;
  assert.strictEqual(summary.kind, 'text');
  assert.match(
    summary.text,
    new RegExp(
      `^> \\*\\*Actual Type\\*\\*: \\[${type}\\]\\(https://futuremachine.org/types/_futuremachine_core.${type}\\.html\\)`
    )
  );
}

describe('FutureMachine TypeDoc Plugin', () => {
  let baselineProject: ProjectReflection;
  let pluginProject: ProjectReflection;
  let baselineDefinesStructProject: ProjectReflection;
  let pluginDefinesStructProject: ProjectReflection;

  before(async () => {
    baselineProject = await getProject(sampleTestSource, []);
    pluginProject = await getProject(sampleTestSource, [loadPlugin]);
    baselineDefinesStructProject = await getProject(
      definesStructTestSource,
      []
    );
    pluginDefinesStructProject = await getProject(definesStructTestSource, [
      loadPlugin,
    ]);
  });

  test('should unwrap Structs', () => {
    const baselineStruct = getDeclaration(baselineProject, 'TestStruct');
    const pluginStruct = getDeclaration(pluginProject, 'TestStruct');
    isUnwrappedStruct(baselineStruct, pluginStruct);
  });

  test('should unwrap aliases for Structs', () => {
    const baselineStruct = getDeclaration(baselineProject, 'TestAlias');
    const pluginStruct = getDeclaration(pluginProject, 'TestAlias');
    isUnwrappedStruct(baselineStruct, pluginStruct);
  });

  test('should unwrap Methods in Structs', () => {
    const baselineStruct = getDeclaration(baselineProject, 'TestStruct');
    const pluginStruct = getDeclaration(pluginProject, 'TestStruct');
    methodsAreUnwrapped(
      getFirstTypeArg(baselineStruct).declaration,
      pluginStruct,
      ['func1', 'func2']
    );
  });

  test('should unwrap Methods in Objects', () => {
    const baselineObject = getDeclaration(baselineProject, 'TestObject');
    const pluginObject = getDeclaration(pluginProject, 'TestObject');
    methodsAreUnwrapped(baselineObject, pluginObject, ['func1', 'func2']);
  });

  test("shouldn't modify vanilla functions in Objects", () => {
    const baselineVanillaObject = getDeclaration(
      baselineProject,
      'TestVanillaObject'
    );
    const pluginVanillaObject = getDeclaration(
      pluginProject,
      'TestVanillaObject'
    );
    // Should be the same except for ids.
    assert.deepStrictEqual(
      cleanIds(pluginVanillaObject),
      cleanIds(baselineVanillaObject)
    );
  });

  test("shouldn't modify vanilla Objects wrapped in a non Struct class", () => {
    const baselineVanillaObject = getDeclaration(
      baselineProject,
      'TestWrappedVanillaObject'
    );
    const pluginVanillaObject = getDeclaration(
      pluginProject,
      'TestWrappedVanillaObject'
    );
    // Should be the same except for ids.
    assert.deepStrictEqual(
      cleanIds(pluginVanillaObject),
      cleanIds(baselineVanillaObject)
    );
  });

  test("shouldn't modify vanilla Objects wrapped in a non core Struct class", () => {
    const baselineVanillaObject = getDeclaration(
      baselineDefinesStructProject,
      'TestNonCoreStruct'
    );
    const pluginVanillaObject = getDeclaration(
      pluginDefinesStructProject,
      'TestNonCoreStruct'
    );
    // Should be the same except for ids.
    assert.deepStrictEqual(
      cleanIds(pluginVanillaObject),
      cleanIds(baselineVanillaObject)
    );
  });

  test("shouldn't modify other classes from core", () => {
    const baselineVanillaObject = getDeclaration(baselineProject, 'TestList');
    const pluginVanillaObject = getDeclaration(pluginProject, 'TestList');
    // Should be the same except for ids.
    assert.deepStrictEqual(
      cleanIds(pluginVanillaObject),
      cleanIds(baselineVanillaObject)
    );
  });

  test('should inject type notice for Struct', () => {
    const pluginStruct = getDeclaration(pluginProject, 'TestStruct');
    hasNotice(pluginStruct!.comment!, 'Struct');
  });

  test('should inject type notice for Method', () => {
    const pluginStruct = getDeclaration(pluginProject, 'TestStruct');
    for (const method of iterateChildren(pluginStruct, ['func1', 'func2'])) {
      hasNotice(method!.comment!, 'Method');
    }
  });

  test('methods are re-parented when unwrapped', () => {
    const pluginStruct = getDeclaration(pluginProject, 'TestStruct');
    for (const method of iterateChildren(pluginStruct, ['func1', 'func2'])) {
      assert.strictEqual(
        method!.getFriendlyFullName(),
        `TestStruct.${method.name}`
      );
    }
  });
});
