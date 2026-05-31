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

const buildSha = (
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.COMMIT_REF ??
  process.env.GITHUB_SHA ??
  'dev'
).slice(0, 7);

const buildTimeIso = new Date().toISOString();

/** Build stamp in index.html lets clients detect stale cached bundles vs live deploy. */
function injectBuildMeta(): Plugin {
  return {
    name: 'inject-build-meta',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const meta = [
          '<meta name="finova-app" content="hs-system-vite" />',
          `<meta name="finova-build-sha" content="${buildSha}" />`,
          `<meta name="finova-build-time" content="${buildTimeIso}" />`,
        ].join('\n    ');
        const canonical =
          process.env.VITE_CANONICAL_APP_URL?.trim().replace(/\/$/, '') ||
          'https://h-s-system.vercel.app';
        const redirectScript = `<script>(function(){try{var c=${JSON.stringify(canonical)};var h=location.hostname.toLowerCase();var ch=new URL(c).hostname.toLowerCase();if(h===ch||h==='localhost'||h==='127.0.0.1'||/^10\\.|^192\\.168\\.|^172\\.(1[6-9]|2\\d|3[01])\\./.test(h))return;if(h.slice(-12)==='.netlify.app'){location.replace(c+location.pathname+location.search+location.hash);}}catch(e){}})();</script>`;
        return html
          .replace('</head>', `    ${meta}\n    ${redirectScript}\n  </head>`);
      },
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  loadEnv(mode, process.cwd(), '');

  return {
    define: {
      __APP_BUILD_SHA__: JSON.stringify(buildSha),
      __APP_BUILD_TIME__: JSON.stringify(buildTimeIso),
      __WEALTH_ANALYTICS_V2__: JSON.stringify(true),
    },
    // Emulates Netlify redirects (`/api/*` → functions). Functions read AI keys from Netlify Site env server-side only.
    plugins: [react(), netlify(), injectBuildMeta(), cssBeforeModuleScripts()],
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
