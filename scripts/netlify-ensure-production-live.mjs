#!/usr/bin/env node
/**
 * CI / local gate: wait for https://finova-hussein.netlify.app to serve EXPECT_SHA,
 * publishing the matching Netlify deploy when NETLIFY_AUTH_TOKEN is available.
 */
import { execSync } from 'node:child_process';
import { FINOVA_NETLIFY_SITE_ID, pickLatestReadyProductionDeploy, publishDeploy } from './netlify-publish-production.mjs';

const siteUrl = 'https://finova-hussein.netlify.app';
const siteId = process.env.NETLIFY_SITE_ID?.trim() || FINOVA_NETLIFY_SITE_ID;
const expectFull = (process.env.EXPECT_SHA || process.env.GITHUB_SHA || '').trim();
const expectShort = expectFull.slice(0, 7);

if (!expectShort || expectShort.length < 7) {
  console.error('Set EXPECT_SHA or GITHUB_SHA (full commit hash).');
  process.exit(1);
}

const BUILD_SHA_META = /name="finova-build-sha"\s+content="([^"]+)"/i;

async function readLiveSha() {
  const res = await fetch(`${siteUrl}/?nocache=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const html = await res.text();
  if (html.includes('esm.sh/react')) return null;
  if (!html.includes('name="finova-app"')) return null;
  return html.match(BUILD_SHA_META)?.[1]?.trim() ?? null;
}

function listDeploys() {
  const json = JSON.stringify({ site_id: siteId, per_page: 20 }).replace(/'/g, `'\\''`);
  const out = execSync(`npx netlify api listSiteDeploys --data '${json}'`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    env: process.env,
  });
  return out.trim() ? JSON.parse(out) : [];
}

function findDeployForSha(deploys) {
  return deploys.find(
    (d) =>
      d.state === 'ready' &&
      d.context === 'production' &&
      typeof d.commit_ref === 'string' &&
      d.commit_ref.startsWith(expectShort),
  );
}

function tryPublishMatchingDeploy() {
  const token = process.env.NETLIFY_AUTH_TOKEN?.trim();
  if (!token) return false;
  try {
    const deploys = listDeploys();
    const match = findDeployForSha(deploys) || pickLatestReadyProductionDeploy(deploys);
    if (!match) return false;
    console.log(`Publishing deploy ${match.id} (${match.commit_ref?.slice(0, 7) || 'unknown'})…`);
    publishDeploy(match.id, siteId);
    return true;
  } catch (err) {
    console.warn(`Publish attempt failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

const maxAttempts = 24;
const delayMs = 15_000;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const live = await readLiveSha();
  console.log(`Attempt ${attempt}/${maxAttempts}: live=${live ?? 'unreachable'} expect=${expectShort}`);
  if (live === expectShort) {
    console.log(`Production ${siteUrl} serves ${expectShort}.`);
    process.exit(0);
  }
  if (attempt === 3 || attempt === 6 || attempt === 10 || attempt === 15) {
    tryPublishMatchingDeploy();
  }
  if (attempt < maxAttempts) {
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

console.error(
  `Production ${siteUrl} does not serve ${expectShort}. Set NETLIFY_AUTH_TOKEN in GitHub secrets and Netlify site env, then re-run deploy.`,
);
process.exit(1);
