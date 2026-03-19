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

            if (id.includes('recharts')) {
              return 'vendor-recharts';
            }

            if (id.includes('/d3-') || id.includes('d3-array') || id.includes('d3-scale') || id.includes('d3-shape')) {
              return 'vendor-d3';
            }

            if (id.includes('react') || id.includes('scheduler')) {
              return 'vendor-react';
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
