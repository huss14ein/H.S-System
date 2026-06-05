import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertVercelRelayOriginAllowed } from '../server/vercelApiRelay';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Vercel API relay — CORS + security', () => {
  it('allows Vercel and Netlify production origins', () => {
    expect(assertVercelRelayOriginAllowed('https://h-s-system.vercel.app')).toBe(true);
    expect(assertVercelRelayOriginAllowed('https://finova-hussein.netlify.app')).toBe(true);
  });

  it('rejects arbitrary third-party origins', () => {
    expect(assertVercelRelayOriginAllowed('https://evil.example.com')).toBe(false);
  });

  it('vercel.json serves local /api routes (no open Netlify proxy rewrite)', () => {
    const vercel = read('vercel.json');
    expect(vercel).not.toContain('finova-hussein.netlify.app/api');
    expect(read('api/gemini-proxy.ts')).toContain('gemini-proxy');
  });

  it('api routes relay to Netlify without browser Origin on upstream', () => {
    expect(read('server/vercelApiRelay.ts')).toContain('NETLIFY_FUNCTIONS_ORIGIN');
    expect(read('server/vercelApiRelay.ts')).not.toContain("'Access-Control-Allow-Origin': '*'");
    expect(read('api/gemini-proxy.ts')).toContain('relayToNetlifyFunction');
  });
});
