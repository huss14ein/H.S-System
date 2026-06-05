/**
 * E2E wiring: deploy hosts, Wealth Analytics bundle, security headers, no redirect-to-404 traps.
 * See .cursor/rules/phase-e2e-verification.mdc
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('deploy completion — Wealth Analytics + production hosts', () => {
  it('vercel.json redirects all traffic to finova-hussein.netlify.app', () => {
    const vercel = read('vercel.json');
    expect(vercel).toContain('"redirects"');
    expect(vercel).toContain('finova-hussein.netlify.app');
    expect(vercel).not.toContain('finova-hussein.netlify.app/api');
  });

  it('canonical redirect only targets Netlify -- permalinks, not production host', () => {
    const redirect = read('utils/canonicalHostRedirect.ts');
    expect(redirect).not.toContain("host.endsWith('.vercel.app')");
    expect(redirect).toContain('isLighthouseAuditUserAgent');
    const vite = read('vite.config.ts');
    expect(vite).toContain('finova-hussein.netlify.app');
    expect(vite).toContain('Chrome-Lighthouse');
    expect(vite).toContain("h.indexOf('--')");
  });

  it('build bakes Wealth Analytics v2 and deploy freshness meta', () => {
    expect(read('vite.config.ts')).toContain('__WEALTH_ANALYTICS_V2__');
    expect(read('vite.config.ts')).toContain('finova-build-sha');
    expect(read('utils/buildInfo.ts')).toContain('hasWealthAnalyticsRollout');
    expect(read('utils/buildInfo.ts')).toContain('finova-hussein.netlify.app');
  });

  it('Netlify ships API rewrite, SPA fallback, and security headers', () => {
    const toml = read('netlify.toml');
    expect(toml).toMatch(/from\s*=\s*"\/api\/\*"/);
    expect(toml).toMatch(/from\s*=\s*"\/\*"/);
    expect(toml).toContain('to = "/index.html"');
    expect(toml).not.toContain('h-s-system.vercel.app');
    expect(toml).toContain('Content-Security-Policy');
    expect(toml).toContain('Strict-Transport-Security');
  });

  it('Netlify Lighthouse audits canonical production URL (not deploy preview redirect)', () => {
    const toml = read('netlify.toml');
    expect(toml).toContain('@netlify/plugin-lighthouse');
    expect(toml).toContain('url = "https://finova-hussein.netlify.app"');
  });

  it('public/_redirects mirrors API rewrite then SPA fallback', () => {
    const redirects = read('public/_redirects');
    expect(redirects).toMatch(/\/api\/\*\s+\/\.netlify\/functions\/:splat/);
    expect(redirects).toMatch(/\/\*\s+\/index\.html\s+200/);
    expect(redirects).not.toContain('302');
  });

  it('GitHub deploy workflow verifies Wealth Analytics and fails if production is stale', () => {
    const wf = read('.github/workflows/deploy-production.yml');
    expect(wf).toContain('Wealth Analytics');
    expect(wf).toContain('finova-build-sha');
    expect(wf).toContain('Wait for live finova-hussein.netlify.app');
    expect(wf).toContain('Production still stale');
    expect(wf).toContain('NETLIFY_BUILD_HOOK');
  });

  it('netlify.toml uses a fast Git build (tests run in CI, not on Netlify)', () => {
    const toml = read('netlify.toml');
    expect(toml).toContain('npm run build');
    expect(toml).not.toContain('npm run test');
  });

  it('Settings surfaces build stamp and Wealth Analytics rollout for deploy verification', () => {
    const settings = read('pages/Settings.tsx');
    expect(settings).toContain('hasWealthAnalyticsRollout');
    expect(settings).toContain('getBuildSha');
    expect(settings).toContain('getCanonicalAppUrl');
    expect(settings).toContain('Wealth Analytics');
  });

  it('DeployFreshnessBanner prompts refresh when bundle is stale', () => {
    expect(read('components/DeployFreshnessBanner.tsx')).toContain('Wealth Analytics');
    expect(read('hooks/useDeployFreshness.ts')).toContain('finova-build-sha');
  });
});
