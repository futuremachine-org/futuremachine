import type { Application, Context, ReferenceType, Reflection } from 'typedoc';
import {
  Comment,
  Converter,
  DeclarationReflection,
  ReflectionGroup,
  ReflectionKind,
} from 'typedoc';
import { assert_defined, assert_true } from './asserts.js';

const corePackageName = '@futuremachine/core';

function isCoreType(
  typeRef: ReferenceType,
  typeName: 'Struct' | 'Method'
): boolean {
  const declRef = typeRef.toDeclarationReference();
  if (declRef.moduleSource !== corePackageName) {
    return false;
  }
  const pathParts = declRef.symbolReference?.path;
  assert_defined(pathParts, `pathParts is undefined.`);
  const pathComponent = pathParts[0];
  assert_defined(pathComponent, `pathComponent is undefined.`);

  return pathComponent.path === typeName;
}

function injectTypeNotice(
  context: Context,
  reflection: Reflection,
  typeName: 'Struct' | 'Method'
) {
  // Stryker disable ConditionalExpression
  const isCoreProject = context.project.name === corePackageName;

  const typeLink = isCoreProject
    ? `[${typeName}](_futuremachine_core.${typeName}.html)`
    : // TODO: Make sure this points to the actual link once the site is hosting the docs.
      `[${typeName}](https://futuremachine.org/types/_futuremachine_core.${typeName}.html)`;

  const noticeMarkdown = [
    `> **Actual Type**: ${typeLink}\\`,
    `<small>*Note: Stripped to generate better documentation.*</small>`,
    '\n',
  ].join('\n');

  reflection.comment ??= new Comment();
  reflection.comment.summary.unshift({ kind: 'text', text: noticeMarkdown });
}

export function load(app: Application) {
  app.converter.on(
    Converter.EVENT_RESOLVE,
    (context: Context, reflection: Reflection) => {
      if (!(reflection instanceof DeclarationReflection)) {
        return;
      }

      unwrapStruct(context, reflection);

      if (reflection.children) {
        reflection.children.forEach((child) => {
          unwrapMethodProperty(context, child);
        });
      }
    }
  );
}

function unwrapMethodProperty(
  context: Context,
  property: DeclarationReflection
) {
  if (property.type?.type !== 'reference') {
    return;
  }
  const typeRef = property.type;
  if (!isCoreType(typeRef, 'Method')) {
    return;
  }
  injectTypeNotice(context, property, 'Method');

  assert_defined(typeRef.typeArguments, `Method missing type argument.`);

  const wrappedFunc = typeRef.typeArguments[0]!;

  property.kind = ReflectionKind.Property;
  property.type = wrappedFunc;
}

function unwrapStruct(context: Context, reflection: DeclarationReflection) {
  if (reflection.type?.type !== 'reference') {
    return;
  }
  if (!isCoreType(reflection.type, 'Struct')) {
    return;
  }
  injectTypeNotice(context, reflection, 'Struct');

  const wrappedStruct = reflection.type.typeArguments?.at(0);
  assert_defined(wrappedStruct, `Struct missing type argument.`);

  assert_true(
    wrappedStruct.type === 'reflection',
    'Struct type argument is not a reflection'
  );

  const wrappedStructDecl = wrappedStruct.declaration;
  const children = wrappedStructDecl.children!;

  children.forEach((child) => {
    child.parent = reflection;
  });

  delete reflection.type;
  reflection.children = children;

  context.project.removeReflection(wrappedStructDecl);

  const propertyGroup = new ReflectionGroup('Properties', reflection);
  propertyGroup.children = children;
  reflection.groups = [propertyGroup];
}
