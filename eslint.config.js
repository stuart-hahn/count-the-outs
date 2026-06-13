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
    ignores: ['node_modules/**'],
  },
];
