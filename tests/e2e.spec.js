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

test('uses a two-column note-card feed layout on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.locator('input[name="account"]').fill('qixiu');
  await page.locator('input[name="password"]').fill('test123');
  await page.locator('form button[type="submit"]').click();

  const cards = page.locator('.request-card');
  await expect(cards.nth(1)).toBeVisible();

  const [firstBox, secondBox] = await Promise.all([
    cards.nth(0).boundingBox(),
    cards.nth(1).boundingBox(),
  ]);
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(Math.abs(firstBox.y - secondBox.y)).toBeLessThanOrEqual(16);
  expect(secondBox.x).toBeGreaterThan(firstBox.x + firstBox.width * 0.72);
  expect(firstBox.width).toBeGreaterThanOrEqual(140);

  const firstCard = cards.nth(0);
  const [heartBox, viewBox] = await Promise.all([
    firstCard.locator('.reaction-button').boundingBox(),
    firstCard.locator('.request-card-actions .button-secondary').boundingBox(),
  ]);
  expect(heartBox).not.toBeNull();
  expect(viewBox).not.toBeNull();
  expect(Math.abs(heartBox.y - viewBox.y)).toBeLessThanOrEqual(12);
  expect(viewBox.x).toBeGreaterThan(heartBox.x + heartBox.width - 2);
});

test('user manages pending and approved requests from my requests', async ({ page }) => {
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await page.goto('/');
  await page.locator('input[name="account"]').fill('qixiu');
  await page.locator('input[name="password"]').fill('test123');
  await page.locator('form').getByRole('button', { name: '登录' }).click();

  await page.locator('.bottom-navigation').getByRole('button', { name: '我的委托' }).click();
  await expect(page.getByRole('heading', { name: '我的委托' })).toBeVisible();

  const pendingTitle = '待撤回的种子委托';
  const pendingCard = page.locator('.my-request-card').filter({ hasText: pendingTitle });
  await expect(pendingCard).toBeVisible();
  await pendingCard.getByRole('button', { name: `撤回委托：${pendingTitle}` }).click();
  await expect(pendingCard.getByText('已撤回', { exact: true })).toBeVisible();
  await pendingCard.getByRole('button', { name: `编辑委托：${pendingTitle}` }).click();

  const editedTitle = '已重新提交的种子委托';
  const editPage = page.locator('.create-request-page');
  await expect(editPage.getByRole('heading', { name: '修改委托' })).toBeVisible();
  await editPage.locator('input[name="title"]').fill(editedTitle);
  await editPage.getByRole('button', { name: '重新提交审核' }).click();

  const resubmittedCard = page.locator('.my-request-card').filter({ hasText: editedTitle });
  await expect(resubmittedCard).toBeVisible();
  await expect(resubmittedCard.getByText('待审核', { exact: true })).toBeVisible();
  await expect(resubmittedCard.getByRole('button', { name: `编辑委托：${editedTitle}` })).toHaveCount(0);

  const rejectedTitle = '未通过的种子委托';
  const rejectedCard = page.locator('.my-request-card').filter({ hasText: rejectedTitle });
  await expect(rejectedCard).toBeVisible();
  await expect(rejectedCard.getByText('未通过', { exact: true })).toBeVisible();
  await expect(rejectedCard.getByRole('button', { name: `编辑委托：${rejectedTitle}` })).toHaveCount(0);

  const approvedTitle = '待关闭的种子委托';
  const approvedCard = page.locator('.my-request-card').filter({ hasText: approvedTitle });
  await approvedCard.getByRole('button', { name: `关闭委托：${approvedTitle}` }).click();
  await expect(approvedCard.getByText('已关闭', { exact: true })).toBeVisible();
  await approvedCard.getByRole('button', { name: `删除委托：${approvedTitle}` }).click();
  await expect(approvedCard).toHaveCount(0);
});

test('user browses feed channels and toggles a heart reaction', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('wanhua');
  await page.getByLabel('密码').fill('test123');
  await page.locator('form').getByRole('button', { name: '登录' }).click();

  await expect(page.getByRole('heading', { name: '万事广场' })).toBeVisible();
  const channels = page.locator('.feed-channel-bar');
  const latestChannel = channels.getByRole('button', { name: '最新' });
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('/api/requests') &&
      response.url().includes('channel=latest') &&
      response.url().includes('sort=latest') &&
      response.ok(),
    ),
    latestChannel.click(),
  ]);
  await expect(latestChannel).toHaveClass(/button-primary/);

  const recommendedChannel = channels.getByRole('button', { name: '推荐' });
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('/api/requests') &&
      response.url().includes('channel=recommended') &&
      response.ok(),
    ),
    recommendedChannel.click(),
  ]);
  await expect(recommendedChannel).toHaveClass(/button-primary/);

  const heart = page.locator('.request-list').getByRole('button', { name: /点亮心形|取消心形/ }).first();
  await expect(heart).toBeVisible();
  const before = await heart.textContent();
  await heart.click();
  await expect(heart).not.toHaveText(before ?? '');
  await expect(page.getByText('点赞')).toHaveCount(0);
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
