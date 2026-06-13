import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@count-the-outs/engine': resolve(__dirname, 'packages/engine/src/index.ts'),
      '@count-the-outs/math': resolve(__dirname, 'packages/math/src/index.ts'),
      '@count-the-outs/training': resolve(__dirname, 'packages/training/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
