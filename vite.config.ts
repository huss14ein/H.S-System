import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import netlify from '@netlify/vite-plugin';
import process from 'process';

/** Stylesheets and modulepreload hints before entry script — avoids CSS chaining behind JS parse. */
function cssBeforeModuleScripts(): Plugin {
  return {
    name: 'css-before-module-scripts',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const styles = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/gi)].map((m) => m[0]);
        const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*>/gi)].map((m) => m[0]);
        if (styles.length === 0 && preloads.length === 0) return html;
        let out = html
          .replace(/<link[^>]*rel="stylesheet"[^>]*>\s*/gi, '')
          .replace(/<link[^>]*rel="modulepreload"[^>]*>\s*/gi, '');
        const firstModuleScript = out.search(/<script[^>]*type="module"/i);
        // Keep stripped `out` — returning `html` would restore links we already removed.
        if (firstModuleScript === -1) return out;
        const injection = [...styles, ...preloads].join('\n  ') + '\n  ';
        return out.slice(0, firstModuleScript) + injection + out.slice(firstModuleScript);
      },
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  loadEnv(mode, process.cwd(), '');

  return {
    // Emulates Netlify redirects (`/api/*` → functions). Functions read AI keys from Netlify Site env server-side only.
    plugins: [react(), netlify(), cssBeforeModuleScripts()],
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

            if (
              /[/\\]node_modules[/\\]react[/\\]/.test(id) ||
              /[/\\]node_modules[/\\]react-dom[/\\]/.test(id) ||
              /[/\\]node_modules[/\\]scheduler[/\\]/.test(id)
            ) {
              return 'vendor-react';
            }

            if (id.includes('@supabase/supabase-js') || id.includes('@supabase/gotrue')) {
              return 'vendor-supabase';
            }

            if (id.includes('@google/genai')) {
              return 'vendor-genai';
            }

            return undefined;
          },
        },
      },
    },
  };
});
