# 举报处置闭环与批量委托审核 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 为管理员补齐委托举报处置闭环，并让待审核委托可安全地批量通过或拒绝。

**Architecture:** 在既有 server/routes/admin.js 中新增举报读取、举报处置和批量审核接口，复用现有管理员鉴权、委托 DTO 与条件状态更新。前端新增独立 AdminReports 页面；AdminRequests 增加只针对待审核委托的选择和批量操作；AdminDashboard 维护四个后台队列的按需加载与摘要。

**Tech Stack:** React 19、Vite、Express 5、better-sqlite3、Vitest、React Testing Library、Supertest、Playwright、lucide-react。

## Global Constraints

- 不新增数据库迁移：reports.status、handlerId、handledAt、resultNote 已存在。
- 第一版只处理 targetType = 'request' 的举报，不展示用户和联系申请举报。
- 举报不会自动处罚；禁用用户继续通过现有用户管理页单条执行。
- “下架并完成处理”仅允许关联委托为 approved，举报更新和委托下架必须在同一 SQLite 事务中完成。
- 批量审核仅允许 pending 委托；仅支持通过与拒绝，拒绝理由必填，单批最多 50 条。
- 任何批量操作不得包含下架、删除、关闭或禁用用户。
- 不泄露举报人、发布者或用户的联系方式。
- 每个任务先写失败测试，再写最小实现；完成后执行指定测试并提交。

---

## File Structure

| 文件 | 职责 |
| --- | --- |
| server/routes/admin.js | 管理员举报查询与处置；批量委托审核。 |
| src/components/AdminShell.jsx | 增加“举报处理”导航入口。 |
| src/pages/admin/AdminDashboard.jsx | 懒加载举报页并维护待处理举报摘要。 |
| src/pages/admin/AdminReports.jsx | 负责举报筛选、处理说明、确认与单条处置。 |
| src/pages/admin/AdminRequests.jsx | 负责待审委托选择、批量理由、确认与请求。 |
| src/styles.css | 举报表、批量操作栏与小屏幕局部样式。 |
| tests/api.requests.test.js | 管理员举报和批量审核 API 测试。 |
| tests/ui.permissions.test.jsx | 后台导航、举报处置和批量审核交互测试。 |
| tests/e2e.spec.js | 真实浏览器的举报下架和批量审核回归。 |

## Public Interfaces

~~~js
// GET /api/admin/reports?status=pending
// response: { reports: AdminReport[] }

// POST /api/admin/reports/:id/dismiss
// body: { resultNote: string }
// response: { report: AdminReport }

// POST /api/admin/reports/:id/takedown
// body: { resultNote: string }
// response: { report: AdminReport, request: ReviewedRequest }

// POST /api/admin/requests/batch-review
// body: { requestIds: number[], decision: 'approve' | 'reject', reason?: string }
// response: { approvedCount, rejectedCount, skipped, failed }
~~~

### Task 1: 管理员举报列表 API

**Files:**
- Modify: server/routes/admin.js
- Modify: tests/api.requests.test.js

**Interfaces:**
- Consumes: requireUser(db)、isAdmin(req.user)、reviewedRequestDto()、loadImagesForRequests()。
- Produces: GET /api/admin/reports?status=pending|resolved|dismissed。

- [ ] **Step 1: 写出失败的举报列表 API 测试**

在 tests/api.requests.test.js 的管理员测试区加入：

~~~js
it('lets admins list request reports without contact details', async () => {
  const requestId = insertRequest({ status: 'approved', title: '被举报的委托' });
  const reportId = db.prepare(
    "INSERT INTO reports (reporterId, targetType, targetId, reason) VALUES (?, 'request', ?, ?)",
  ).run(users.wanhua, requestId, '疑似虚假交易').lastInsertRowid;

  const nonAdmin = await request(app).get('/api/admin/reports?status=pending').set(auth(users.qixiu));
  const invalid = await request(app).get('/api/admin/reports?status=closed').set(auth(users.admin));
  const listed = await request(app).get('/api/admin/reports?status=pending').set(auth(users.admin));

  expect(nonAdmin.status).toBe(403);
  expect(invalid.status).toBe(400);
  expect(listed.body.reports).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: Number(reportId), status: 'pending', reason: '疑似虚假交易',
      request: expect.objectContaining({ id: requestId, title: '被举报的委托' }),
      reporter: expect.objectContaining({ id: users.wanhua }),
    }),
  ]));
  expectNoKeys(listed.body, ['contactValue', 'passwordHash', 'openid']);
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: npm test -- --run tests/api.requests.test.js

Expected: 新用例因 /api/admin/reports 返回 404 而失败。

- [ ] **Step 3: 实现举报 DTO 和读取路由**

在 ADMIN_REQUEST_QUERY 后新增 REPORT_STATUSES、ADMIN_REPORT_QUERY、loadAdminReport() 与 reportDto()。查询固定 targetType = 'request'，按 createdAt DESC, id DESC 排序；关联委托使用 loadReviewedRequestWithImages()，举报人与处理人只返回 id、nickname。

~~~js
const REPORT_STATUSES = ['pending', 'resolved', 'dismissed'];

router.get('/reports', (req, res, next) => {
  try {
    const status = req.query.status;
    if (status !== undefined && !REPORT_STATUSES.includes(status)) {
      throw clientError(400, 'Invalid report status');
    }
    const rows = loadRequestReportRows(db, status);
    const reports = rows
      .map((row) => ({ row, target: loadReviewedRequestWithImages(db, row.targetId) }))
      .filter(({ target }) => target)
      .map(({ row, target }) => reportDto(row, target));
    return res.json({ reports });
  } catch (error) {
    return next(error);
  }
});
~~~

loadRequestReportRows() 必须使用参数化 status 条件，不能拼接用户输入。reportDto() 不得返回 contactValue、passwordHash、openid。

- [ ] **Step 4: 运行 API 测试确认通过**

Run: npm test -- --run tests/api.requests.test.js

Expected: api.requests.test.js 全部通过。

- [ ] **Step 5: 提交**

~~~bash
git add server/routes/admin.js tests/api.requests.test.js
git commit -m "feat: list request reports for admins"
~~~

### Task 2: 举报处置与原子下架 API

**Files:**
- Modify: server/routes/admin.js
- Modify: tests/api.requests.test.js

**Interfaces:**
- Consumes: Task 1 的举报查询、requiredText()、positiveId()。
- Produces: POST /api/admin/reports/:id/dismiss 和 POST /api/admin/reports/:id/takedown。

- [ ] **Step 1: 写出失败的处置 API 测试**

~~~js
it('records an immutable report decision and atomically takes down its request', async () => {
  const dismissedRequestId = insertRequest({ status: 'approved' });
  const takenDownRequestId = insertRequest({ status: 'approved' });
  const dismissId = db.prepare(
    "INSERT INTO reports (reporterId, targetType, targetId, reason) VALUES (?, 'request', ?, ?)",
  ).run(users.wanhua, dismissedRequestId, '不属实').lastInsertRowid;
  const takedownId = db.prepare(
    "INSERT INTO reports (reporterId, targetType, targetId, reason) VALUES (?, 'request', ?, ?)",
  ).run(users.wanhua, takenDownRequestId, '疑似诈骗').lastInsertRowid;

  const dismissed = await request(app).post('/api/admin/reports/' + dismissId + '/dismiss')
    .set(auth(users.admin)).send({ resultNote: '核查后无需处置' });
  const takenDown = await request(app).post('/api/admin/reports/' + takedownId + '/takedown')
    .set(auth(users.admin)).send({ resultNote: '存在风险，已下架' });
  const repeated = await request(app).post('/api/admin/reports/' + takedownId + '/dismiss')
    .set(auth(users.admin)).send({ resultNote: '再次处理' });

  expect(dismissed.body.report).toMatchObject({ status: 'dismissed', resultNote: '核查后无需处置' });
  expect(takenDown.body.report).toMatchObject({ status: 'resolved', resultNote: '存在风险，已下架' });
  expect(takenDown.body.request).toMatchObject({ status: 'taken_down', takedownReason: '存在风险，已下架' });
  expect(repeated.status).toBe(409);
});
~~~

补充普通用户 403、缺少 resultNote 返回 400、关联委托不再为 approved 时 409 且举报保持 pending 的断言。

- [ ] **Step 2: 运行测试确认失败**

Run: npm test -- --run tests/api.requests.test.js

Expected: 新处置请求返回 404。

- [ ] **Step 3: 实现不可重复处置和事务下架**

新增 handleReport(action)。两条路径均使用 WHERE id = ? AND status = 'pending'。takedown 分支使用 db.transaction()：先条件更新关联委托，再条件更新举报；任一步 changes === 0 即抛出 clientError(409, ...) 并回滚。

~~~js
router.post('/reports/:id/dismiss', handleReport('dismiss'));
router.post('/reports/:id/takedown', handleReport('takedown'));
~~~

dismiss 写入 status = dismissed、handlerId、handledAt、resultNote，不修改委托。takedown 写入 status = resolved，并将同一说明写入 requests.takedownReason。

- [ ] **Step 4: 运行 API 测试确认原子性**

Run: npm test -- --run tests/api.requests.test.js

Expected: 举报列表、两种处置、状态竞争和鉴权用例全部通过。

- [ ] **Step 5: 提交**

~~~bash
git add server/routes/admin.js tests/api.requests.test.js
git commit -m "feat: handle request reports in admin"
~~~

### Task 3: 批量委托审核 API

**Files:**
- Modify: server/routes/admin.js
- Modify: tests/api.requests.test.js

**Interfaces:**
- Consumes: 既有单条审核的有效期、用户活跃、认证状态约束。
- Produces: POST /api/admin/requests/batch-review。

- [ ] **Step 1: 写出失败的批量审核 API 测试**

~~~js
it('batch reviews only pending requests and reports skipped ids', async () => {
  const approvableId = insertRequest({ status: 'pending', title: '批量通过' });
  const rejectedId = insertRequest({ status: 'pending', title: '批量拒绝' });
  const alreadyApprovedId = insertRequest({ status: 'approved', title: '应跳过' });

  const approved = await request(app).post('/api/admin/requests/batch-review').set(auth(users.admin))
    .send({ requestIds: [approvableId, alreadyApprovedId], decision: 'approve' });
  const rejected = await request(app).post('/api/admin/requests/batch-review').set(auth(users.admin))
    .send({ requestIds: [rejectedId], decision: 'reject', reason: '不符合发布范围' });

  expect(approved.body).toMatchObject({ approvedCount: 1, rejectedCount: 0, failed: [] });
  expect(approved.body.skipped).toEqual([{ id: alreadyApprovedId, reason: 'Request is not pending' }]);
  expect(rejected.body).toMatchObject({ approvedCount: 0, rejectedCount: 1, failed: [] });
  expect(db.prepare('SELECT status FROM requests WHERE id = ?').get(approvableId).status).toBe('approved');
  expect(db.prepare('SELECT rejectReason FROM requests WHERE id = ?').get(rejectedId).rejectReason).toBe('不符合发布范围');
});
~~~

增加空数组、超过 50 条、重复或非法 ID、无效 decision、拒绝缺少理由、普通用户访问，以及不满足通过资格时被跳过的测试。

- [ ] **Step 2: 运行测试确认失败**

Run: npm test -- --run tests/api.requests.test.js

Expected: 批量审核请求返回 404。

- [ ] **Step 3: 提取单条批准条件并实现批量端点**

从 transitionRequest() 提取 pendingApprovalCondition，保证单条和批量批准的有效期、用户状态、认证状态完全一致。新增输入解析：

~~~js
function parseBatchReview(body) {
  if (!Array.isArray(body?.requestIds) || body.requestIds.length === 0 || body.requestIds.length > 50) {
    throw clientError(400, 'requestIds must contain 1 to 50 ids');
  }
  const requestIds = [...new Set(body.requestIds)];
  if (requestIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw clientError(400, 'requestIds must contain positive integer ids');
  }
  if (!['approve', 'reject'].includes(body.decision)) {
    throw clientError(400, 'decision must be approve or reject');
  }
  return {
    requestIds,
    decision: body.decision,
    reason: body.decision === 'reject' ? requiredText(body.reason, 'reason') : null,
  };
}
~~~

对每个 ID 使用 UPDATE requests ... WHERE id = ? AND status = 'pending'。条件不满足的项目记录为 skipped：非待审核使用 Request is not pending，不符合批准资格使用 Request cannot be approved。响应始终含 approvedCount、rejectedCount、skipped、failed；业务跳过不放入 failed。

- [ ] **Step 4: 运行 API 测试确认通过**

Run: npm test -- --run tests/api.requests.test.js

Expected: 单条审核与新增批量审核用例全部通过。

- [ ] **Step 5: 提交**

~~~bash
git add server/routes/admin.js tests/api.requests.test.js
git commit -m "feat: batch review pending requests"
~~~

### Task 4: 举报处理后台页与摘要

**Files:**
- Create: src/pages/admin/AdminReports.jsx
- Modify: src/components/AdminShell.jsx
- Modify: src/pages/admin/AdminDashboard.jsx
- Modify: src/styles.css
- Modify: tests/ui.permissions.test.jsx

**Interfaces:**
- Consumes: Task 1、Task 2 接口，api()、StatusBadge、visibleDetailRows()。
- Produces: 举报处理页和待处理摘要。

- [ ] **Step 1: 写出失败的后台举报 UI 测试**

导入 AdminReports 并定义 pendingReport。加入以下用例，并在 AdminDashboard 懒加载测试中断言“举报处理”和“待处理举报 1”。

~~~jsx
it('takes down a pending request report after confirmation', async () => {
  fetch
    .mockResolvedValueOnce(jsonResponse({ reports: [pendingReport] }))
    .mockResolvedValueOnce(jsonResponse({
      report: { ...pendingReport, status: 'resolved' },
      request: { ...reviewedRequest, status: 'taken_down' },
    }))
    .mockResolvedValueOnce(jsonResponse({ reports: [] }));
  const user = userEvent.setup();
  render(<AdminReports />);

  await user.type(await screen.findByLabelText('举报 61 处理说明'), '存在风险，已下架');
  await user.click(screen.getByRole('button', { name: '下架委托并完成处理' }));
  expect(screen.getByRole('dialog', { name: '确认处理举报' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '确认下架并处理' }));

  expect(fetch).toHaveBeenNthCalledWith(2, '/api/admin/reports/61/takedown', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ resultNote: '存在风险，已下架' }),
  }));
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: npm test -- --run tests/ui.permissions.test.jsx

Expected: 因无法导入 AdminReports 或没有“举报处理”导航而失败。

- [ ] **Step 3: 实现页面、导航、摘要和确认面板**

在 AdminShell.jsx 导入 ShieldAlert 并新增：

~~~jsx
{ id: 'reports', label: '举报处理', Icon: ShieldAlert },
~~~

AdminDashboard 的 summary 增加 reports，显示 待处理举报 N，并按现有 visitedTabs 模式加载：

~~~jsx
{visitedTabs.has('reports') && <div hidden={activeTab !== 'reports'}><AdminReports onSummaryChange={setReportCount} /></div>}
~~~

AdminReports 复用 AdminRequests 的 AbortController、mountedRef 与单 mutation owner 模式。提供状态筛选、举报表、aria-label 为“举报 <id> 处理说明”的 textarea，以及“无需处置”“下架委托并完成处理”按钮。确认面板使用 role=dialog 和 aria-label“确认处理举报”；成功后刷新当前筛选并刷新 pending 摘要。关联委托详情复用 visibleDetailRows 和 .admin-request-image-grid。

在 src/styles.css 增加 .admin-table-reports、.admin-confirmation 和小屏幕换行样式，不改变用户端信息流布局。

- [ ] **Step 4: 运行 UI 测试确认通过**

Run: npm test -- --run tests/ui.permissions.test.jsx

Expected: 举报筛选、说明校验、二次确认、摘要刷新与既有后台测试通过。

- [ ] **Step 5: 提交**

~~~bash
git add src/components/AdminShell.jsx src/pages/admin/AdminDashboard.jsx src/pages/admin/AdminReports.jsx src/styles.css tests/ui.permissions.test.jsx
git commit -m "feat: add admin report moderation"
~~~

### Task 5: 委托审核页的批量选择与操作

**Files:**
- Modify: src/pages/admin/AdminRequests.jsx
- Modify: src/styles.css
- Modify: tests/ui.permissions.test.jsx

**Interfaces:**
- Consumes: Task 3 的批量审核响应，以及现有 load() 和 refreshPendingSummary()。
- Produces: 当前筛选结果内的批量通过、批量拒绝和跳过提示。

- [ ] **Step 1: 写出失败的批量审核 UI 测试**

~~~jsx
it('batch approves selected pending requests and clears selection after refresh', async () => {
  const secondPending = { ...reviewedRequest, id: 42, title: '第二条待审委托' };
  fetch
    .mockResolvedValueOnce(jsonResponse({
      requests: [reviewedRequest, secondPending, { ...reviewedRequest, id: 43, status: 'approved' }],
    }))
    .mockResolvedValueOnce(jsonResponse({ approvedCount: 2, rejectedCount: 0, skipped: [], failed: [] }))
    .mockResolvedValueOnce(jsonResponse({ requests: [] }))
    .mockResolvedValueOnce(jsonResponse({ requests: [] }));
  const user = userEvent.setup();
  render(<AdminRequests />);

  await user.click(await screen.findByRole('checkbox', { name: '选择委托 41' }));
  await user.click(screen.getByRole('checkbox', { name: '选择委托 42' }));
  expect(screen.queryByRole('checkbox', { name: '选择委托 43' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '批量通过 2 条' }));
  await user.click(screen.getByRole('button', { name: '确认批量通过' }));

  expect(fetch).toHaveBeenNthCalledWith(2, '/api/admin/requests/batch-review', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ requestIds: [41, 42], decision: 'approve' }),
  }));
});
~~~

增加全选只选 pending 行、拒绝理由为空不可确认、更改筛选清空选择和跳过项提示的用例。

- [ ] **Step 2: 运行测试确认失败**

Run: npm test -- --run tests/ui.permissions.test.jsx

Expected: 找不到选择框或“批量通过”按钮。

- [ ] **Step 3: 实现选择状态、确认与批量 mutation**

在 AdminRequests 增加以下状态和派生集合：

~~~jsx
const [selectedIds, setSelectedIds] = useState(() => new Set());
const [batchDecision, setBatchDecision] = useState(null);
const [batchReason, setBatchReason] = useState('');
const selectableItems = items.filter((item) => item.status === 'pending');
const selectedPendingIds = selectableItems.map((item) => item.id).filter((id) => selectedIds.has(id));
~~~

待审核行渲染 aria-label 为“选择委托 <id>”的 checkbox；表头“全选当前筛选结果”只基于 selectableItems。每次 load() 成功、筛选提交、单条审核成功或批量审核成功后清空选择。

批量操作栏仅在 selectedPendingIds.length > 0 时显示。拒绝理由使用 aria-label“批量拒绝理由”，为空时禁用批量拒绝确认。确认面板使用 role=dialog 和 aria-label“确认批量审核”，确认请求为：

~~~js
await api('/api/admin/requests/batch-review', {
  method: 'POST',
  signal: controller.signal,
  body: {
    requestIds: selectedPendingIds,
    decision: batchDecision,
    ...(batchDecision === 'reject' ? { reason: batchReason.trim() } : {}),
  },
});
~~~

反馈固定为“批量审核完成：通过 X 条，拒绝 Y 条，跳过 Z 条。”；failed.length 大于 0 时以 role=alert 展示失败项目。批量请求复用 mutationOwnerRef，与单条审核互斥。

src/styles.css 新增 .admin-batch-toolbar、.admin-selection-cell、.admin-batch-summary；桌面端紧凑横排，小屏幕纵向排列，checkbox 不改变表格列宽。

- [ ] **Step 4: 运行 UI 测试确认通过**

Run: npm test -- --run tests/ui.permissions.test.jsx

Expected: 批量选择、全选范围、拒绝理由、确认、刷新清空和跳过提示通过，单条审核不回归。

- [ ] **Step 5: 提交**

~~~bash
git add src/pages/admin/AdminRequests.jsx src/styles.css tests/ui.permissions.test.jsx
git commit -m "feat: add batch request review controls"
~~~

### Task 6: 端到端回归与最终验证

**Files:**
- Modify: tests/e2e.spec.js
- Modify only if needed for stable seed data: server/db.js

**Interfaces:**
- Consumes: 完成后的管理员举报页、批量审核 UI 与现有 admin/admin123 种子账号。
- Produces: 浏览器级的举报下架与批量审核证据。

- [ ] **Step 1: 写出失败的端到端用例**

新增流程：wanhua 举报公开委托后退出；admin/admin123 登录、在“举报处理”下架委托；再进入“委托审核”，选择两条待审核委托并批量通过。

~~~js
test('admin handles a report and batch reviews pending requests', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('wanhua');
  await page.getByLabel('密码').fill('test123');
  await page.locator('form').getByRole('button', { name: '登录' }).click();
  await page.getByRole('button', { name: '查看委托' }).first().click();
  await page.getByRole('button', { name: '举报委托' }).click();
  await page.getByLabel('举报原因').fill('疑似虚假信息，请掌柜核查。');
  await page.getByRole('button', { name: '确认举报' }).click();
  await page.getByRole('button', { name: '退出登录' }).click();

  await page.getByRole('textbox', { name: '账号' }).fill('admin');
  await page.getByLabel('密码').fill('admin123');
  await page.locator('form').getByRole('button', { name: '登录' }).click();
  await page.getByRole('button', { name: '举报处理' }).click();
  await page.getByLabel(/举报 .* 处理说明/).fill('风险信息已下架。');
  await page.getByRole('button', { name: '下架委托并完成处理' }).click();
  await page.getByRole('button', { name: '确认下架并处理' }).click();

  await page.getByRole('button', { name: '委托审核' }).click();
  await page.getByRole('checkbox', { name: /选择委托/ }).nth(0).check();
  await page.getByRole('checkbox', { name: /选择委托/ }).nth(1).check();
  await page.getByRole('button', { name: '批量通过 2 条' }).click();
  await page.getByRole('button', { name: '确认批量通过' }).click();
  await expect(page.getByRole('status')).toContainText('批量审核完成');
});
~~~

- [ ] **Step 2: 运行端到端用例确认失败**

Run: npm run e2e -- --grep "admin handles a report"

Expected: 在举报后台页或批量控件缺失处失败。

- [ ] **Step 3: 固化测试数据和选择器**

如需稳定定位，给 server/db.js 的两条待审种子委托使用唯一标题；只调整测试需要的标题或选择器，不能改变生产权限或审核规则。

- [ ] **Step 4: 运行完整质量门禁**

Run: npm test

Expected: 所有 Vitest 测试通过。

Run: npm run build

Expected: Vite 生产构建成功。

Run: npm run e2e

Expected: 所有 Playwright 用例通过。

Run: git diff --check

Expected: 无空白错误。

- [ ] **Step 5: 提交**

~~~bash
git add tests/e2e.spec.js server/db.js
git commit -m "test: cover report moderation and batch review"
~~~

## Self-Review

- 委托举报限定、处置状态、原子下架和无自动封禁由 Task 1 与 Task 2 覆盖。
- 批量待审核限制、50 条上限、拒绝理由、业务跳过和高风险操作排除由 Task 3 与 Task 5 覆盖。
- 后台导航、待处理摘要、关联委托详情和确认交互由 Task 4 覆盖。
- 用户端举报到管理员下架、批量审核和所有质量门禁由 Task 6 覆盖。
- 计划中的路径、字段名、状态值和接口与已批准设计文档一致；未包含占位条目或未命名接口。
