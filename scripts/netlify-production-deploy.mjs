#!/usr/bin/env node
/**
 * Publish dist/ + Netlify functions to https://finova-hussein.netlify.app
 *
 * Set ONE of:
 *   NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID  (Personal access token + site id)
 *   NETLIFY_BUILD_HOOK                    (Build hook URL from Netlify UI)
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const siteUrl = 'https://finova-hussein.netlify.app';
const dist = 'dist';

if (!existsSync(`${dist}/index.html`)) {
  console.error(`Missing ${dist}/index.html — run npm run build first.`);
  process.exit(1);
}

const token = process.env.NETLIFY_AUTH_TOKEN?.trim();
const siteId = process.env.NETLIFY_SITE_ID?.trim();
const buildHook = process.env.NETLIFY_BUILD_HOOK?.trim();
const sha = (process.env.GITHUB_SHA || process.env.COMMIT_REF || 'local').slice(0, 7);

if (token && siteId) {
  console.log(`Netlify CLI deploy → ${siteUrl} (${sha})`);
  execSync(
    `npx netlify deploy --prod --dir=${dist} --site=${siteId} --message "Deploy ${sha} from CI"`,
    {
      stdio: 'inherit',
      env: { ...process.env, NETLIFY_AUTH_TOKEN: token },
    },
  );
  process.exit(0);
}

if (buildHook) {
  console.log(`Netlify build hook → ${siteUrl} (${sha})`);
  const res = await fetch(buildHook, { method: 'POST', body: '{}' });
  if (!res.ok) {
    console.error(`Build hook failed: HTTP ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log('Build hook accepted — Netlify will build from linked repo + netlify.toml.');
  process.exit(0);
}

console.error(`
Cannot deploy to ${siteUrl}.

Add ONE of these to GitHub → Settings → Secrets and variables → Actions:

  1) NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID
     Netlify → User settings → Applications → Personal access tokens
     Netlify → Site finova-hussein → Site configuration → General → Site ID

  2) NETLIFY_BUILD_HOOK
     Netlify → Site finova-hussein → Build & deploy → Build hooks → Add build hook (branch main)

Or link the site to this repo in Netlify (Build & deploy → Link repository → H.S-System, main).
`);
process.exit(1);
