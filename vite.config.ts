import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import process from 'process';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;

            if (id.includes('recharts') || id.includes('d3-')) {
              return 'vendor-charts';
            }

            if (id.includes('@google/genai') || id.includes('@supabase/supabase-js')) {
              return 'vendor-services';
            }

            return undefined;
          },
        },
      },
    },
  };
});
