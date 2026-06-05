#!/usr/bin/env node
/**
 * Publish dist/ + Netlify functions to https://finova-hussein.netlify.app
 *
 * Set ONE of:
 *   NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID  (Personal access token; site id defaults to finova-hussein)
 *   NETLIFY_BUILD_HOOK                    (Build hook URL — then run publish script if deploy stays locked)
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { FINOVA_NETLIFY_SITE_ID, publishLatestProductionDeploy } from './netlify-publish-production.mjs';

const siteUrl = 'https://finova-hussein.netlify.app';
const dist = 'dist';

if (!existsSync(`${dist}/index.html`)) {
  console.error(`Missing ${dist}/index.html — run npm run build first.`);
  process.exit(1);
}

const token = process.env.NETLIFY_AUTH_TOKEN?.trim();
const siteId = process.env.NETLIFY_SITE_ID?.trim() || FINOVA_NETLIFY_SITE_ID;
const buildHook = process.env.NETLIFY_BUILD_HOOK?.trim();
const sha = (process.env.GITHUB_SHA || process.env.COMMIT_REF || 'local').slice(0, 7);

function tryPublishLatestLockedDeploy() {
  if (!token) return false;
  try {
    publishLatestProductionDeploy(siteId);
    return true;
  } catch (err) {
    console.warn(
      `Could not auto-publish latest locked deploy: ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }
}

if (token && siteId) {
  console.log(`Netlify CLI deploy → ${siteUrl} (${sha})`);
  try {
    execSync(
      `npx netlify deploy --prod --dir=${dist} --site=${siteId} --message "Deploy ${sha} from CI"`,
      {
        stdio: 'inherit',
        env: { ...process.env, NETLIFY_AUTH_TOKEN: token, NETLIFY_SITE_ID: siteId },
      },
    );
  } catch {
    console.warn('CLI deploy failed or production is locked — attempting restoreSiteDeploy on latest ready build.');
    if (!tryPublishLatestLockedDeploy()) process.exit(1);
  }

  // Locked deploys build but do not auto-publish — ensure production alias points at latest ready deploy.
  tryPublishLatestLockedDeploy();
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
  if (token) {
    console.log('Waiting 90s for Netlify build, then publishing if locked…');
    await new Promise((r) => setTimeout(r, 90_000));
    tryPublishLatestLockedDeploy();
  }
  process.exit(0);
}

console.error(`
Cannot deploy to ${siteUrl}.

Add ONE of these to GitHub → Settings → Secrets and variables → Actions:

  1) NETLIFY_AUTH_TOKEN (+ optional NETLIFY_SITE_ID; defaults to finova-hussein)
     Netlify → User settings → Applications → Personal access tokens
     Site ID (public): ${FINOVA_NETLIFY_SITE_ID}

  2) NETLIFY_BUILD_HOOK (+ NETLIFY_AUTH_TOKEN to auto-publish when deploys are locked)
     Netlify → Site finova-hussein → Build & deploy → Build hooks → Add build hook (branch main)

Or link the site to this repo in Netlify (Build & deploy → Link repository → H.S-System, main).
`);
process.exit(1);
