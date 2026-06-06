/**
 * Login / unauthenticated shell must not pull full app CSS or chart vendors on first paint.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('login performance — lean unauthenticated shell', () => {
  it('App lazy-loads auth pages and defers full CSS to AppStylesGate', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/lazy\(\(\)\s*=>\s*import\(['"]\.\/pages\/LoginPage['"]\)/);
    expect(app).toMatch(/lazy\(\(\)\s*=>\s*import\(['"]\.\/pages\/SignupPage['"]\)/);
    expect(app).toMatch(/lazy\(\(\)\s*=>\s*import\(['"]\.\/components\/AppStylesGate['"]\)/);
    expect(app).not.toMatch(/import LoginPage from/);
    expect(read('index.tsx')).not.toMatch(/import\s+['"]\.\/index\.css['"]/);
  });

  it('index.html uses non-blocking auth-shell.css preload', () => {
    const html = read('index.html');
    expect(html).toContain('rel="preload" href="/auth-shell.css" as="style"');
    const headWithoutNoscript = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, '');
    expect(headWithoutNoscript).not.toMatch(/<link rel="stylesheet" href="\/auth-shell\.css"/);
  });

  it('production dist keeps auth-shell non-blocking (no hashed app CSS in head)', () => {
    const distHtml = join(process.cwd(), 'dist/index.html');
    if (!existsSync(distHtml)) {
      execSync('npm run build', { stdio: 'pipe' });
    }
    const html = readFileSync(distHtml, 'utf8');
    expect(html).not.toMatch(/assets\/index-[^"']+\.css/);
    expect(html).not.toMatch(/assets\/H-[^"']+\.css/);
    expect(html).toMatch(/auth-shell\.css/);
    const distWithoutNoscript = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, '');
    expect(distWithoutNoscript).not.toMatch(/<link rel="stylesheet" href="\/auth-shell\.css"/);
  }, 60000);

  it('entry chunk does not statically import recharts or full index.css', () => {
    const distHtml = join(process.cwd(), 'dist/index.html');
    if (!existsSync(distHtml)) {
      execSync('npm run build', { stdio: 'pipe' });
    }
    const html = readFileSync(distHtml, 'utf8');
    const entryMatch = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    expect(entryMatch, 'entry script in dist/index.html').toBeTruthy();
    const entrySrc = join(process.cwd(), 'dist', entryMatch![1]!.replace(/^\//, ''));
    const entry = readFileSync(entrySrc, 'utf8');
    expect(entry).not.toMatch(/import\s*\{[^}]*\}\s*from\s*["'][^"']*recharts/);
    expect(entry).not.toContain('index.css');
    expect(entry).not.toMatch(/^import[^;]*vendor-recharts/m);
  }, 60000);
});
