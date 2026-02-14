import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// FIX: Import `process` to provide correct Node.js types for `process.cwd()`
// and resolve TypeScript error.
import process from 'process';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    define: {
      // Expose VITE_API_KEY from .env file as process.env.API_KEY to the client-side code,
      // adhering to the Gemini API service's requirement for accessing the key.
      'process.env.API_KEY': JSON.stringify(env.VITE_API_KEY)
    }
  };
});