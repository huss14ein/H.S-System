/**
 * System-wide Rules of Hooks guards — prevents React #310/#300 across pages.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTsx(full, out);
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/**
 * Detect loading-gate early returns that skip later hooks:
 *   if (!ready) { return ( ... LoadingSpinner / "Loading ..." ) }
 *   ... later useMemo / useCallback / useCompanyNames
 */
function findLoadingReturnBeforeHook(src: string): string | null {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*if\s*\(/.test(line)) continue;
    // Look ahead ~8 lines for a loading-style return
    const window = lines.slice(i, i + 10).join('\n');
    const isLoadingGate =
      /return\s*\(/.test(window) &&
      /(LoadingSpinner|SectionLoadingPlaceholder|aria-busy|Loading\s|loading\.\.\.|Loading investment|Loading\s+\w+)/i.test(
        window,
      );
    if (!isLoadingGate) continue;

    const indent = line.length - line.trimStart().length;
    // After this if-block, look for body-level hooks at similar indent
    for (let j = i + 1; j < Math.min(lines.length, i + 400); j++) {
      const L = lines[j];
      const ind = L.length - L.trimStart().length;
      const t = L.trimStart();
      // left the component / entered a new top-level declaration
      if (ind === 0 && /^(export |const |function |class )/.test(t) && j > i + 5) break;
      if (ind > indent + 4) continue; // nested inside the if / deeper block
      if (ind < indent) break;
      if (
        /^(?:const|let)\s+.*=\s*(?:React\.)?use(Memo|Effect|Callback|State|Ref|Context)\b/.test(t) ||
        /\buseCompanyNames\s*\(/.test(t) ||
        /^(?:const|let)\s+.*=\s*use[A-Z][A-Za-z]+\s*\(/.test(t)
      ) {
        // Ensure this hook is AFTER the closing of the early-return if block
        // Simple check: we've seen a `}` at indent matching the if, or we're past a return (
        const between = lines.slice(i, j).join('\n');
        if (/return\s*\(/.test(between) || /return\s+null/.test(between)) {
          return `L${i + 1} loading return → L${j + 1} ${t.slice(0, 90)}`;
        }
      }
    }
  }
  return null;
}

describe('system-wide hooks stability', () => {
  it('DashboardCanIInvestCard runs useMemo before capitalDeployment early return', () => {
    const src = read('components/dashboard/DashboardCanIInvestCard.tsx');
    const memoIdx = src.indexOf('useMemo(');
    const earlyReturnIdx = src.indexOf('if (!capitalDeployment) return null');
    expect(memoIdx).toBeGreaterThan(-1);
    expect(earlyReturnIdx).toBeGreaterThan(-1);
    expect(memoIdx).toBeLessThan(earlyReturnIdx);
  });

  it('canonical metrics hooks do not early-return before local hook calls', () => {
    const src = read('hooks/useCanonicalFinancialMetrics.ts');
    expect(src).toContain('shell?.full.simulatedPrices ?? debounced');
    expect(src).toContain('useCanonicalFinancialMetricsLocal({ skip: !!shell })');
    expect(src).toContain('useDashboardCanonicalMetricsLocal({ skip: !!shell })');
    expect(src).not.toMatch(/if \(shell\) return shell\.full;\s*\n\s*return useCanonicalFinancialMetricsLocal/);
    expect(src).not.toMatch(/if \(shell\) return shell\.dashboard;\s*\n\s*return useDashboardCanonicalMetricsLocal/);
  });

  it('InvestmentPlan loading return is after all hooks (no React #310)', () => {
    const src = read('pages/Investments.tsx');
    const planStart = src.indexOf('const InvestmentPlan: React.FC');
    expect(planStart).toBeGreaterThan(-1);
    const slice = src.slice(planStart);
    const lastCompanyNames = slice.lastIndexOf('useCompanyNames(');
    const loadingReturn = slice.indexOf('Loading investment plan strategy');
    expect(lastCompanyNames).toBeGreaterThan(-1);
    expect(loadingReturn).toBeGreaterThan(-1);
    expect(loadingReturn).toBeGreaterThan(lastCompanyNames);
    expect(slice).toContain('After all hooks — Rules of Hooks');
  });

  it('NotificationBell does not call useNotifications inside click handler', () => {
    const src = read('components/NotificationBell.tsx');
    expect(src).toContain('sendNotification');
    expect(src).not.toMatch(/handleRequestPermission[\s\S]{0,200}useNotifications\(\)/);
  });

  it('no loading-gate early return skips later hooks in pages/components', () => {
    const offenders: string[] = [];
    for (const dir of ['pages', 'components'].map((d) => join(ROOT, d))) {
      for (const file of walkTsx(dir)) {
        const rel = file.slice(ROOT.length + 1);
        const hit = findLoadingReturnBeforeHook(readFileSync(file, 'utf8'));
        if (hit) offenders.push(`${rel}: ${hit}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
