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

  it('GitHub deploy workflow ensures production serves push sha (no stale alias)', () => {
    const wf = read('.github/workflows/deploy-production.yml');
    expect(wf).toContain('Wealth Analytics');
    expect(wf).toContain('finova-build-sha');
    expect(wf).toContain('Ensure production serves this commit');
    expect(wf).toContain('netlify-ensure-production-live.mjs');
    expect(wf).toContain('NETLIFY_BUILD_HOOK');
    expect(wf).not.toContain('accepting newer deploy');
  });

  it('Netlify build self-publishes production alias when NETLIFY_AUTH_TOKEN is set', () => {
    const toml = read('netlify.toml');
    expect(toml).toContain('npm run build');
    expect(toml).toContain('netlify-self-publish.mjs');
    expect(toml).not.toContain('npm run test');
    const selfPub = read('scripts/netlify-self-publish.mjs');
    expect(selfPub).toContain('publishDeploy');
    expect(selfPub).toContain('CONTEXT');
    expect(selfPub).toContain('DEPLOY_ID');
    expect(read('scripts/netlify-ensure-production-live.mjs')).toContain('finova-build-sha');
  });

  it('Settings surfaces build stamp and Wealth Analytics rollout for deploy verification', () => {
    const settings = read('pages/Settings.tsx');
    expect(settings).toContain('hasWealthAnalyticsRollout');
    expect(settings).toContain('getBuildSha');
    expect(settings).toContain('getCanonicalAppUrl');
    expect(settings).toContain('Wealth Analytics');
  });

  it('Dashboard links to Wealth Analytics for moved charts and executive summary', () => {
    const dash = read('pages/Dashboard.tsx');
    expect(dash).toContain('WealthAnalyticsGuideBanner');
    expect(dash).toContain("setActivePage('Wealth Analytics')");
    expect(read('components/WealthAnalyticsGuideBanner.tsx')).toContain('Overview → Wealth Analytics');
  });

  it('Layout surfaces partial data load warnings app-wide', () => {
    expect(read('components/Layout.tsx')).toContain('DataLoadWarningBanner');
    expect(read('components/DataLoadWarningBanner.tsx')).toContain('transactionsLoadWarning');
  });

  it('auth session stability wiring (login loop fixes)', () => {
    expect(read('services/supabaseAuthLock.ts')).toMatch(/mutex|lock/i);
    expect(read('services/syncUserApprovalProfile.ts')).toContain('markAuthSignInForProfileSync');
    expect(read('context/AuthContext.tsx')).toContain('queueMicrotask');
    expect(read('index.tsx')).toContain('import.meta.env.DEV ? <React.StrictMode>');
  });

  it('signup approval DB bootstrap includes first-user owner RPC', () => {
    const sql = read('supabase/migrations/20260601180000_first_auth_user_owner_bootstrap.sql');
    expect(sql).toContain('ensure_own_user_profile');
    expect(read('supabase/migrations/20260531200000_approve_verified_email_users.sql')).toContain('approved');
  });

  it('performance: no destructive hydrate race; staggered idle prefetch', () => {
    expect(read('context/DataContext.tsx')).not.toContain('continuing with partial workspace');
    expect(read('context/DataContext.tsx')).toContain('secondaryFetchPromise');
    expect(read('utils/lazyPages.tsx')).toContain('one route at a time');
    expect(read('components/AuthenticatedAppShell.tsx')).toContain('prefetchCommonPagesIdle(), 6000');
  });

  it('live prices: manual refresh only; cache restore on hydrate', () => {
    expect(read('components/MarketSimulator.tsx')).toContain('computeRestoreCachedQuotesPatch');
    expect(read('components/MarketSimulator.tsx')).not.toMatch(/didInitialPricePassRef/);
    expect(read('context/MarketDataContext.tsx')).toContain('scope.manual === true');
    expect(read('services/cachedQuoteRestore.ts')).toContain('computeRestoreCachedQuotesPatch');
  });

  it('net worth trend forward-fills missing snapshot days', () => {
    expect(read('components/charts/NetWorthCockpit.tsx')).toContain('buildNetWorthTrendSeriesFromSnapshots');
    expect(read('services/netWorthChartDense.ts')).toContain('forwardFillNetWorthTrendRows');
  });
});
