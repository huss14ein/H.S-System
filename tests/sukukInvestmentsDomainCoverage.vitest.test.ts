import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTsFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(full);
  }
  return acc;
}

const scanRoots = ['services', 'pages', 'hooks', 'components'].map((r) => join(ROOT, r));

const bannedPatterns = [
  { re: /sumPersonalSukukAssetsSar\s*\(/, label: 'sumPersonalSukukAssetsSar(' },
  { re: /type\s*===\s*['"]Sukuk['"]/, label: "type === 'Sukuk' on assets" },
  { re: /assets\.filter\([^)]*Sukuk/, label: 'assets.filter(...Sukuk' },
];

const allowlist = [
  'services/sukuk/sukukExposure.ts',
  'services/personalNetWorth.ts',
  'services/extendedMetricsPresentation.ts',
  'services/headlineInvestmentAllocation.ts',
  'hooks/useCanonicalFinancialMetrics.ts',
];

describe('sukuk investments domain coverage', () => {
  it('canonical metrics expose sukukPositionsValueSar', () => {
    const src = readFileSync(join(ROOT, 'services/canonicalFinancialMetrics.ts'), 'utf8');
    expect(src).toContain('sukukPositionsValueSar');
    expect(src).toContain('sumPersonalSukukPositionsSar');
  });

  it('no asset-table Sukuk reads in services/pages (except deprecated aliases)', () => {
    const offenders: string[] = [];
    for (const root of scanRoots) {
      for (const file of walkTsFiles(root)) {
        const rel = file.slice(ROOT.length + 1);
        if (allowlist.some((a) => rel.endsWith(a))) continue;
        if (rel.includes('SukukInvestmentsSection')) continue;
        const text = readFileSync(file, 'utf8');
        for (const { re, label } of bannedPatterns) {
          if (re.test(text)) offenders.push(`${rel}: ${label}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('Investments page has Sukuk tab for direct contracts', () => {
    const page = readFileSync(join(ROOT, 'pages/Investments.tsx'), 'utf8');
    expect(page).toContain("SukukInvestmentsSection");
    expect(page).toContain("'Sukuk'");
  });

  it('Assets page no longer adds Sukuk as physical asset type', () => {
    const page = readFileSync(join(ROOT, 'pages/Assets.tsx'), 'utf8');
    expect(page).not.toContain("label: 'Add Sukuk'");
    expect(page).not.toContain('SukukPayoutScheduleModal');
  });
});
