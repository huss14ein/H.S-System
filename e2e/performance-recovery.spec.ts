import { test, expect } from '@playwright/test';

const PRIMARY_ROUTES: Array<{ hash: string; label: string }> = [
  { hash: '#Dashboard', label: 'Dashboard' },
  { hash: '#Budgets', label: 'Budgets' },
  { hash: '#Transactions', label: 'Transactions' },
  { hash: '#Summary', label: 'Summary' },
  { hash: '#Investments', label: 'Investments' },
];

function isStatementWrite(url: string, method: string): boolean {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  return /financial_statements/i.test(url);
}

test.describe('Performance recovery (browser)', () => {
  test('primary routes render main content within navigation budget', async ({ page }) => {
    const navBudgetMs = 8_000;
    await page.goto('/');
    await expect(page.locator('#root')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Welcome Back|Configuration Error/i }).or(page.locator('#main-content')),
    ).first().toBeVisible({ timeout: 30_000 });

    const onLogin = await page.getByRole('heading', { name: /Welcome Back/i }).isVisible().catch(() => false);
    if (onLogin) {
      test.info().annotations.push({
        type: 'note',
        description: 'Unauthenticated — route timing skipped; run signed-in preview for full E2E.',
      });
      return;
    }

    for (const route of PRIMARY_ROUTES) {
      const started = Date.now();
      await page.goto(`/${route.hash}`);
      await expect(page.locator('#main-content')).toBeVisible({ timeout: navBudgetMs });
      const elapsed = Date.now() - started;
      expect(
        elapsed,
        `${route.label} navigation should stay under ${navBudgetMs}ms (got ${elapsed}ms)`,
      ).toBeLessThan(navBudgetMs);
    }
  });

  test('Dashboard load does not write to financial_statements', async ({ page }) => {
    const writes: Array<{ method: string; url: string }> = [];
    page.on('request', (req) => {
      const method = req.method();
      const url = req.url();
      if (isStatementWrite(url, method)) {
        writes.push({ method, url });
      }
    });

    await page.goto('/#Dashboard');
    await expect(page.locator('#root')).toBeVisible();
    await page.waitForTimeout(4_000);

    const onLogin = await page.getByRole('heading', { name: /Welcome Back/i }).isVisible().catch(() => false);
    if (onLogin) return;

    await expect(page.locator('#main-content')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);

    expect(
      writes,
      `Expected 0 financial_statements writes on Dashboard load, got: ${writes.map((w) => `${w.method} ${w.url}`).join('; ')}`,
    ).toEqual([]);
  });
});
