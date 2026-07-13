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

test('shows trade typed fields and image upload controls on the create page', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('textbox', { name: '账号' }).fill('qixiu');
  await page.getByLabel('密码').fill('test123');
  await page.locator('form').getByRole('button', { name: '登录' }).click();

  await page.locator('.bottom-navigation').getByRole('button', { name: '发个委托' }).click();
  const createPage = page.locator('.create-request-page');
  await expect(createPage).toBeVisible();
  await createPage.locator('select[name="type"]').selectOption('trade');
  await expect(createPage.locator('select[name="type"]')).toHaveValue('trade');

  await createPage.locator('input[name="title"]').fill('自家红薯礼盒');
  await createPage.locator('input[name="itemName"]').fill('自家红薯礼盒');
  await createPage.locator('input[name="price"]').fill('68元/箱');
  await createPage.locator('input[name="condition"]').fill('5斤装');
  await createPage.locator('input[name="deliveryMethod"]').fill('快递发货');

  await expect(createPage.locator('input[type="file"]')).toBeVisible();
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
