import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
// FIX: Refactor to use defineConfig as a function wrapper.
// This provides the correct execution context and types for the config, resolving issues with 'process.cwd()'.
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    define: {
      // Expose the VITE_GEMINI_API_KEY as process.env.API_KEY to the client code
      // This is required by the @google/genai library guidelines.
      'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY)
    }
  }
})
