/**
 * E2E wiring: browser → /api/gemini-proxy health → AiContext → Executive Summary hint.
 * See .cursor/rules/phase-e2e-verification.mdc
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HandlerEvent } from '@netlify/functions';
import { assertBrowserOriginAllowed } from '../netlify/functions/corsAllowlist';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('AI proxy completion — CORS + health + UI', () => {
  it('netlify.toml routes /api/* to functions and sets function env for CORS', () => {
    const toml = read('netlify.toml');
    expect(toml).toMatch(/from\s*=\s*"\/api\/\*"/);
    expect(toml).toContain('FINOVA_CANONICAL_APP_URL');
    expect(toml).toContain('ALLOWED_ORIGINS');
    expect(toml).toContain('[context.all.environment]');
  });

  it('public/_redirects mirrors API rewrite before SPA fallback', () => {
    expect(read('public/_redirects')).toMatch(/\/api\/\*\s+\/\.netlify\/functions\/:splat/);
  });

  it('gemini-proxy applies origin gate for all POST bodies including health', () => {
    const src = read('netlify/functions/gemini-proxy.ts');
    expect(src).toContain('isHealthProbeBody');
    expect(src).toMatch(/if\s*\(!assertBrowserOriginAllowed\(event\)\)/);
    expect(src).not.toMatch(/!healthProbe && !assertBrowserOriginAllowed/);
    expect(src).toContain('corsHeaders(event, { health: true })');
  });

  it('corsAllowlist allows same Host as Origin without ALLOWED_ORIGINS env', () => {
    const event = {
      headers: {
        origin: 'https://deploy-id-abc.netlify.app',
        host: 'deploy-id-abc.netlify.app',
      },
    } as HandlerEvent;
    expect(assertBrowserOriginAllowed(event)).toBe(true);
  });

  it('client health probe uses same-host /api only (no auth preflight)', () => {
    const src = read('services/aiProxyEndpoints.ts');
    expect(src).toContain("const paths = ['/api/gemini-proxy']");
    expect(src).not.toContain('/.netlify/functions/gemini-proxy');
    expect(src).toMatch(/fetch\(endpoint,\s*\{[\s\S]*method:\s*'POST'[\s\S]*'Content-Type':\s*'application\/json'/);
    expect(src).not.toMatch(/getAiProxyAuthorizationHeader/);
  });

  it('AiContext maps health to origin_blocked only via fetchGeminiProxyHealthStatus', () => {
    const ctx = read('context/AiContext.tsx');
    expect(ctx).toContain('fetchGeminiProxyHealthStatus');
    expect(ctx).toContain("unreachableReason === 'origin_forbidden'");
    expect(ctx).toContain("setAiUnavailableReason('origin_blocked')");
  });

  it('Executive Summary surfaces AiProxyUnavailableHint when AI is off', () => {
    const summary = read('components/dashboard/AIExecutiveSummary.tsx');
    const hint = read('components/AiProxyUnavailableHint.tsx');
    expect(summary).toContain('AiProxyUnavailableHint');
    expect(summary).toContain('AI summary is off');
    expect(hint).toContain('refreshAiHealth');
    expect(hint).toContain('Retry connection check');
  });

  it('GitHub deploy workflow smoke-tests production HTML after Netlify deploy', () => {
    const wf = read('.github/workflows/deploy-production.yml');
    expect(wf).toContain('Ensure production serves this commit');
    expect(wf).toContain('netlify-ensure-production-live.mjs');
    expect(wf).toContain('finova-build-sha');
    expect(wf).toContain('finova-app');
  });

  it('GitHub deploy workflow smoke-tests AI proxy CORS with Origin header', () => {
    const wf = read('.github/workflows/deploy-production.yml');
    expect(wf).toContain('/api/gemini-proxy');
    expect(wf).toContain('Origin:');
    expect(wf).toContain('anyProviderConfigured');
  });
});
