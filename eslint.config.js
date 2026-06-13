import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  ...tsPlugin.configs['flat/recommended'],
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts', 'vitest.config.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['packages/cli/src/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: ['node_modules/**'],
  },
];
