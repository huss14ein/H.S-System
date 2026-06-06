#!/usr/bin/env node
/**
 * After a Netlify production build, point finova-hussein.netlify.app at THIS deploy.
 * Runs from netlify.toml build command when NETLIFY=true (locked deploys otherwise stay unpublished).
 *
 * Set NETLIFY_AUTH_TOKEN in Netlify → Site configuration → Environment variables (build scope).
 */
import { FINOVA_NETLIFY_SITE_ID, publishDeploy } from './netlify-publish-production.mjs';

const siteUrl = 'https://finova-hussein.netlify.app';

if (process.env.NETLIFY !== 'true') {
  process.exit(0);
}

const context = (process.env.CONTEXT || '').toLowerCase();
if (context !== 'production') {
  console.log(`Skip self-publish for context=${context || 'unknown'}`);
  process.exit(0);
}

const token = process.env.NETLIFY_AUTH_TOKEN?.trim();
const deployId = process.env.DEPLOY_ID?.trim();
const siteId = process.env.SITE_ID?.trim() || FINOVA_NETLIFY_SITE_ID;
const sha = (process.env.COMMIT_REF || process.env.COMMIT_SHA || '').slice(0, 7);

if (!token) {
  console.warn(
    `[netlify-self-publish] ${siteUrl} may stay on an older deploy until NETLIFY_AUTH_TOKEN is set in Netlify site environment variables.`,
  );
  process.exit(0);
}

if (!deployId) {
  console.warn('[netlify-self-publish] Missing DEPLOY_ID — cannot publish alias.');
  process.exit(0);
}

try {
  console.log(`[netlify-self-publish] Publishing deploy ${deployId} (${sha || 'unknown'}) → ${siteUrl}`);
  publishDeploy(deployId, siteId);
  console.log(`[netlify-self-publish] Production alias updated.`);
} catch (err) {
  console.error(`[netlify-self-publish] Failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
