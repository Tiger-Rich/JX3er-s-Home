import { expect, test } from '@playwright/test';

if (!process.env.VITEST) {
  test('smoke loads the identity-first user shell', async ({ page }) => {
    await page.goto('/');

    await page.locator('input[name="account"]').fill('qixiu');
    await page.locator('input[name="password"]').fill('test123');
    await page.locator('form').getByRole('button', { name: '登录' }).click();

    await expect(page.getByRole('heading', { name: '番薯万事屋' })).toBeVisible();
    await expect(page.getByRole('button', { name: '万事广场' })).toBeVisible();
    await expect(page.getByRole('button', { name: '我的名片' })).toBeVisible();
    await expect(page.getByText('我的番薯名片')).toHaveCount(0);
    await expect(page.getByText('匿名')).toHaveCount(0);
  });
}
