import { test, expect } from '@playwright/test';

test.describe('App shell', () => {
  test('loads Finova (login or authenticated shell)', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Finova/i);
    await expect(page.locator('#root')).toBeVisible();
    const shell = page
      .getByRole('heading', { name: /Welcome Back|Configuration Error/i })
      .or(page.locator('#main-content'));
    await expect(shell.first()).toBeVisible({ timeout: 30_000 });
  });
});
