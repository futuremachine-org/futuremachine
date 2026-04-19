import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import { defineConfig } from 'eslint/config';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

// eslint-disable-next-line no-undef
const gitignorePath = fileURLToPath(new URL('.gitignore', import.meta.url));

export default defineConfig([
  includeIgnoreFile(gitignorePath, 'Imported .gitignore rules.'),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'prettier/prettier': 'warn',
      eqeqeq: ['error', 'always'],
      'no-param-reassign': 'error',
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        {
          considerDefaultExhaustiveForUnions: true,
        },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/explicit-member-accessibility': [
        'warn',
        {
          accessibility: 'explicit',
          overrides: {
            constructors: 'no-public',
          },
        },
      ],
    },
  },
]);
