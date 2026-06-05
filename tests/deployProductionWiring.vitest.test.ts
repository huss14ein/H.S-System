import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('production deploy wiring', () => {
  it('vite config injects build stamp meta tags for stale-bundle detection', () => {
    const vite = fs.readFileSync(path.join(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(vite).toContain('finova-build-sha');
    expect(vite).toContain('finova-app');
  });

  it('deploy-production workflow builds dist, publishes Netlify, and fails if stale', () => {
    const wf = fs.readFileSync(path.join(process.cwd(), '.github/workflows/deploy-production.yml'), 'utf8');
    expect(wf).toContain('deploy-production');
    expect(wf).toContain('netlify-production-deploy.mjs');
    expect(wf).toContain('Wealth Analytics');
    expect(wf).toContain('NETLIFY_BUILD_HOOK');
    expect(wf).toContain('Production still stale');
    expect(wf).toContain('esm.sh/react');
  });

  it('netlify deploy script supports CLI token and build hook', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts/netlify-production-deploy.mjs'), 'utf8');
    expect(script).toContain('NETLIFY_BUILD_HOOK');
    expect(script).toContain('finova-hussein.netlify.app');
    expect(script).toContain('netlify-publish-production.mjs');
  });

  it('netlify publish script unlocks locked production deploys', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts/netlify-publish-production.mjs'), 'utf8');
    expect(script).toContain('restoreSiteDeploy');
    expect(script).toContain('unlockDeploy');
    expect(script).toContain('801d32fc-62bd-4211-8520-b5c1dea9dcae');
  });

  it('missing hashed assets return 404 instead of cached index.html', () => {
    const redirects = fs.readFileSync(path.join(process.cwd(), 'public/_redirects'), 'utf8');
    const netlify = fs.readFileSync(path.join(process.cwd(), 'netlify.toml'), 'utf8');
    expect(redirects).toMatch(/\/assets\/\*.*404/);
    expect(netlify).toContain('/assets/*');
    expect(netlify).toContain('status = 404');
  });

  it('vercel.json redirects to Netlify production', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'));
    expect(vercel.redirects[0].destination).toContain('finova-hussein.netlify.app');
  });
});
