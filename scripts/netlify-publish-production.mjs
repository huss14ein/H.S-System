#!/usr/bin/env node
/**
 * Publish the latest ready production deploy when Netlify "locked deploys" blocks auto-publish.
 * Uses Netlify Open API via CLI (`netlify api …`) — requires NETLIFY_AUTH_TOKEN.
 */
import { execSync } from 'node:child_process';

/** finova-hussein — public site id, not a secret. */
export const FINOVA_NETLIFY_SITE_ID = '801d32fc-62bd-4211-8520-b5c1dea9dcae';

const siteUrl = 'https://finova-hussein.netlify.app';

function netlifyApi(operation, payload) {
  const json = JSON.stringify(payload).replace(/'/g, `'\\''`);
  const out = execSync(`npx netlify api ${operation} --data '${json}'`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    env: process.env,
  });
  return out.trim() ? JSON.parse(out) : null;
}

/** @returns {Array<{ id: string; state: string; context: string; branch?: string; published_at?: string; locked?: boolean; commit_ref?: string }>} */
function listRecentDeploys(siteId, perPage = 15) {
  return netlifyApi('listSiteDeploys', { site_id: siteId, per_page: perPage });
}

export function pickLatestReadyProductionDeploy(deploys) {
  return deploys.find(
    (d) =>
      d.state === 'ready' &&
      d.context === 'production' &&
      (d.branch === 'main' || !d.branch),
  );
}

export function publishDeploy(deployId, siteId = FINOVA_NETLIFY_SITE_ID) {
  netlifyApi('restoreSiteDeploy', { site_id: siteId, deploy_id: deployId });
  try {
    netlifyApi('unlockDeploy', { deploy_id: deployId });
  } catch {
    // unlock is best-effort when deploy is not locked
  }
}

export function publishLatestProductionDeploy(siteId = FINOVA_NETLIFY_SITE_ID) {
  const token = process.env.NETLIFY_AUTH_TOKEN?.trim();
  if (!token) {
    throw new Error('NETLIFY_AUTH_TOKEN is required to publish via Netlify API.');
  }

  const deploys = listRecentDeploys(siteId);
  const latest = pickLatestReadyProductionDeploy(deploys);
  if (!latest) {
    throw new Error(`No ready production deploy found for site ${siteId}.`);
  }

  const sha = latest.commit_ref?.slice(0, 7) ?? 'unknown';
  const wasPublished = Boolean(latest.published_at);
  console.log(
    `Publishing deploy ${latest.id} (${sha})${latest.locked ? ' [was locked]' : ''}${wasPublished ? ' [already published — refreshing]' : ''}`,
  );
  publishDeploy(latest.id, siteId);
  console.log(`Production ${siteUrl} now serves ${sha}.`);
  return { deployId: latest.id, sha, siteUrl };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    publishLatestProductionDeploy(process.env.NETLIFY_SITE_ID?.trim() || FINOVA_NETLIFY_SITE_ID);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
