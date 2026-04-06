// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress'],
  testRunner: 'command',
  commandRunner: {
    command: 'npm run test:stryker',
  },
  buildCommand: 'npx tsc -b',
  coverageAnalysis: 'off',
  checkers: ['typescript'],
  mutator: {
    excludedMutations: ['StringLiteral'],
  },
};
