import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    /** Legacy `engineIntegration.test.ts` self-runs with `npx tsx`; Vitest-only files use `*.vitest.test.ts`. */
    include: ['tests/**/*.vitest.test.ts'],
    exclude: ['node_modules'],
  },
});
