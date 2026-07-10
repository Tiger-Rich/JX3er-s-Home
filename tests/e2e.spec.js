import { expect, test } from '@playwright/test';

test('shows the login-first initial UI before entering the user shell', async ({ page }) => {
  await page.goto('/');

  const authMode = page.getByRole('group', { name: '账号操作' });
  await expect(page.getByText('番薯万事屋', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '登录番薯万事屋' })).toBeVisible();
  await expect(authMode.getByRole('button', { name: '登录' })).toBeVisible();
  await expect(authMode.getByRole('button', { name: '注册' })).toBeVisible();
  await expect(page.locator('form').getByRole('button', { name: '登录' })).toBeVisible();

  await expect(page.getByRole('button', { name: '万事广场' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '我的名片' })).toHaveCount(0);
  await expect(page.getByText('我的番薯名片')).toHaveCount(0);
  await expect(page.getByText('匿名')).toHaveCount(0);
});

test('loads the seeded user shell after login', async ({ page }) => {
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

test('keeps feed content clear of the fixed bottom navigation on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.locator('input[name="account"]').fill('qixiu');
  await page.locator('input[name="password"]').fill('test123');
  await page.locator('form').getByRole('button', { name: '登录' }).click();

  const bottomNav = page.locator('.bottom-navigation');
  const lastCard = page.locator('.request-card').last();
  await expect(lastCard).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  const [navBox, cardBox] = await Promise.all([
    bottomNav.boundingBox(),
    lastCard.boundingBox(),
  ]);

  expect(navBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(navBox.y - 8);
});
