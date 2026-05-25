import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveShellPage } from '../utils/lazyPages';

describe('lazyPages routing', () => {
  it('Commodities resolves to its own shell page, not Assets', () => {
    expect(resolveShellPage('Commodities')).toBe('Commodities');
  });

  it('PAGE_MODULES Commodities lazy-imports Commodities.tsx', () => {
    const src = readFileSync(join(process.cwd(), 'utils/lazyPages.tsx'), 'utf8');
    expect(src).toMatch(/Commodities:\s*lazyPage\(\(\)\s*=>\s*import\('\.\.\/pages\/Commodities'\)/);
    expect(src).not.toMatch(/Commodities:\s*lazyPage\(\(\)\s*=>\s*import\('\.\.\/pages\/Assets'\)/);
  });
});
