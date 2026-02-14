import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// FIX: Import 'process' to fix TypeScript error "Property 'cwd' does not exist on type 'Process'".
import process from 'process';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    define: {
      '__APP_GEMINI_API_KEY__': JSON.stringify(env.VITE_API_KEY || env.GEMINI_API_KEY || env.API_KEY)
    }
  };
});