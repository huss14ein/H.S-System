import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('production deploy wiring', () => {
  it('vite config injects build stamp meta tags for stale-bundle detection', () => {
    const vite = fs.readFileSync(path.join(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(vite).toContain('finova-build-sha');
    expect(vite).toContain('finova-app');
  });

  it('deploy-production workflow builds dist and can publish to Netlify', () => {
    const wf = fs.readFileSync(path.join(process.cwd(), '.github/workflows/deploy-production.yml'), 'utf8');
    expect(wf).toContain('deploy-production');
    expect(wf).toContain('netlify deploy --prod');
    expect(wf).toContain('Wealth Analytics');
    expect(wf).toContain('NETLIFY_SITE_ID');
  });

  it('vercel.json keeps SPA shell uncached and assets immutable', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'));
    const indexHeader = vercel.headers.find((h: { source: string }) => h.source === '/index.html');
    expect(indexHeader.headers.some((x: { value: string }) => x.value.includes('must-revalidate'))).toBe(true);
    const assetHeader = vercel.headers.find((h: { source: string }) => h.source === '/assets/(.*)');
    expect(assetHeader.headers.some((x: { value: string }) => x.value.includes('immutable'))).toBe(true);
  });
});
