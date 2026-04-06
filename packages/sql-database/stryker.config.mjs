import parentConfig from '../../stryker.parent.mjs';

// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...parentConfig,
  tsconfigFile: 'tsconfig.json',
  mutate: ['src/**/*.ts', '!src/asserts.ts', '!src/index.ts'],
};
