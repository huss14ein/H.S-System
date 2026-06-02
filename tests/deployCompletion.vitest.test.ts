/**
 * E2E wiring: deploy hosts, Wealth Analytics bundle, security headers, no redirect-to-404 traps.
 * See .cursor/rules/phase-e2e-verification.mdc
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('deploy completion — Wealth Analytics + production hosts', () => {
  it('vercel.json serves the SPA and proxies /api to Netlify (no redirect-to-404)', () => {
    const vercel = read('vercel.json');
    expect(vercel).not.toContain('"redirects"');
    expect(vercel).toContain('/api/:path*');
    expect(vercel).toContain('finova-hussein.netlify.app/api/:path*');
    expect(vercel).toContain('/index.html');
    expect(vercel).toContain('Content-Security-Policy');
    expect(vercel).toContain('X-Frame-Options');
  });

  it('canonical redirect only targets Netlify -- permalinks, not Vercel production', () => {
    const redirect = read('utils/canonicalHostRedirect.ts');
    expect(redirect).not.toContain("host.endsWith('.vercel.app')");
    const vite = read('vite.config.ts');
    expect(vite).not.toContain("h.slice(-11)==='.vercel.app'");
    expect(vite).toContain("h.indexOf('--')");
  });

  it('build bakes Wealth Analytics v2 and deploy freshness meta', () => {
    expect(read('vite.config.ts')).toContain('__WEALTH_ANALYTICS_V2__');
    expect(read('vite.config.ts')).toContain('finova-build-sha');
    expect(read('utils/buildInfo.ts')).toContain('hasWealthAnalyticsRollout');
    expect(read('utils/buildInfo.ts')).toContain('VERCEL_FALLBACK_APP_URL');
  });

  it('Netlify ships API rewrite, SPA fallback, and security headers', () => {
    const toml = read('netlify.toml');
    expect(toml).toMatch(/from\s*=\s*"\/api\/\*"/);
    expect(toml).toMatch(/from\s*=\s"\/\*"/);
    expect(toml).toContain('h-s-system.vercel.app');
    expect(toml).toContain('Content-Security-Policy');
    expect(toml).toContain('Strict-Transport-Security');
  });

  it('public/_redirects mirrors API rewrite before SPA fallback', () => {
    expect(read('public/_redirects')).toMatch(/\/api\/\*\s+\/\.netlify\/functions\/:splat/);
  });

  it('GitHub deploy workflow verifies Wealth Analytics in dist and smoke-tests live site', () => {
    const wf = read('.github/workflows/deploy-production.yml');
    expect(wf).toContain('Wealth Analytics');
    expect(wf).toContain('finova-build-sha');
    expect(wf).toContain('Smoke test Netlify production URL');
    expect(wf).toContain('HTTP');
  });

  it('Settings surfaces build stamp and Wealth Analytics rollout for deploy verification', () => {
    const settings = read('pages/Settings.tsx');
    expect(settings).toContain('hasWealthAnalyticsRollout');
    expect(settings).toContain('getBuildSha');
    expect(settings).toContain('VERCEL_FALLBACK_APP_URL');
  });

  it('DeployFreshnessBanner prompts refresh when bundle is stale', () => {
    expect(read('components/DeployFreshnessBanner.tsx')).toContain('Wealth Analytics');
    expect(read('hooks/useDeployFreshness.ts')).toContain('finova-build-sha');
  });
});
