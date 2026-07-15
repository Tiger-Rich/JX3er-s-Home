# My Requests Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the user-facing “我的委托” management flow with withdraw, close, soft-hide, edit-and-resubmit, and admin hard delete.

**Architecture:** Extend the existing Express + SQLite request model with two owner lifecycle states and owner visibility columns. Add a dedicated owner-only router under `/api/my/requests` so public feed/detail rules stay conservative, reuse the existing typed request validation for resubmission, and add a React page reachable from the bottom navigation.

**Tech Stack:** React 19, Vite 8, lucide-react, Express 5, better-sqlite3, Vitest, Testing Library, Playwright.

## Global Constraints

- 管理能力服务发布者，不替代管理员审核。
- 公共可见性必须保守：撤回、关闭、下架、过期、拒绝的委托都不进入万事广场。
- 发布者删除只做用户侧隐藏，不硬删数据库记录。
- 管理员可以彻底删除委托，用于违规、测试数据或明确需要清理的记录。
- 已发布委托不能直接编辑，避免绕过审核修改公共内容。
- 修改后重新提交只允许发生在「已撤回」和「未通过」状态。
- 不做复制重发。
- 用户侧删除只允许 `closed` 委托，并设置 `ownerHiddenAt`。
- 管理员硬删除使用 `DELETE /api/admin/requests/:id`。
- 全量测试、build、e2e 必须通过后才能更新 PR。

---

## File Structure

- `server/schema.sql`: add `withdrawn` and `closed` statuses plus owner lifecycle columns.
- `server/db.js`: add migration for the new columns and status CHECK rebuild where needed.
- `server/domain.js`: expose updated request statuses and small status predicates.
- `server/requestPayload.js`: new shared parser/normalizer for create and resubmit request payloads.
- `server/routes/requests.js`: consume shared payload helper for existing publication flow.
- `server/routes/myRequests.js`: new owner-only request management API.
- `server/routes/admin.js`: expose `DELETE /api/admin/requests/:id` and new statuses.
- `server/app.js`: mount `/api/my/requests`.
- `src/domain/constants.js`: add labels for `withdrawn` and `closed`.
- `src/domain/myRequests.js`: action/status helpers for the page.
- `src/pages/MyRequestsPage.jsx`: new user-facing management page.
- `src/pages/CreateRequestPage.jsx`: support editing/resubmitting an existing owner request.
- `src/App.jsx`: route `myRequests` tab and edit flow.
- `src/components/AppShell.jsx`: add bottom-nav entry.
- `src/pages/admin/AdminRequests.jsx`: add hard-delete control.
- `src/styles.css`: management page and action styles.
- `tests/db.test.js`: schema/migration coverage.
- `tests/api.requests.test.js`: owner lifecycle and public visibility coverage.
- `tests/ui.permissions.test.jsx`: user/admin UI coverage.
- `tests/e2e.spec.js`: user workflow coverage.

---

### Task 1: Request Lifecycle Schema and Owner API

**Files:**
- Create: `server/requestPayload.js`
- Create: `server/routes/myRequests.js`
- Modify: `server/schema.sql`
- Modify: `server/db.js`
- Modify: `server/domain.js`
- Modify: `server/routes/requests.js`
- Modify: `server/app.js`
- Test: `tests/db.test.js`
- Test: `tests/api.requests.test.js`

**Interfaces:**
- Produces: `buildRequestValuesFromBody(userId, body, options)` in `server/requestPayload.js`, returning normalized request insert/update values.
- Produces: `createMyRequestsRouter(db)` mounted at `/api/my/requests`.
- Produces owner API:
  - `GET /api/my/requests`
  - `GET /api/my/requests/:id`
  - `POST /api/my/requests/:id/withdraw`
  - `POST /api/my/requests/:id/close`
  - `POST /api/my/requests/:id/hide`
  - `PUT /api/my/requests/:id`
- Consumes existing helpers: `normalizeRequestDetails`, `buildRequestDescription`, `requestIndustry`, `loadImagesForRequests`, and `requireUser(db)`.

- [ ] **Step 1: Write failing schema tests**

Add to `tests/db.test.js`:

```js
it('supports owner request lifecycle columns and statuses', () => {
  const columns = db.prepare('PRAGMA table_info(requests)').all();
  expect(columns.map(({ name }) => name)).toEqual(expect.arrayContaining([
    'withdrawnAt',
    'closedAt',
    'ownerHiddenAt',
  ]));

  const qixiu = db.prepare("SELECT id FROM users WHERE account = 'qixiu'").get();
  for (const status of ['withdrawn', 'closed']) {
    expect(() => db.prepare(`
      INSERT INTO requests
        (ownerId, type, title, description, expiresAt, status, details)
      VALUES (?, 'other', ?, 'Lifecycle test', '2099-01-01T00:00:00.000Z', ?, '{}')
    `).run(qixiu.id, `Lifecycle ${status}`, status)).not.toThrow();
  }
});
```

- [ ] **Step 2: Write failing owner API tests**

Add to `tests/api.requests.test.js`:

```js
it('lets owners list private lifecycle states and hides owner-hidden closed requests', async () => {
  const pendingId = insertRequest({ status: 'pending', title: 'Pending mine' });
  const closedId = insertRequest({ status: 'closed', title: 'Closed mine' });
  const hiddenId = insertRequest({ status: 'closed', title: 'Hidden mine' });
  db.prepare('UPDATE requests SET ownerHiddenAt = CURRENT_TIMESTAMP WHERE id = ?').run(hiddenId);

  const response = await request(app)
    .get('/api/my/requests')
    .set(auth(users.qixiu));

  expect(response.status).toBe(200);
  expect(response.body.requests.map(({ id }) => id)).toEqual(
    expect.arrayContaining([pendingId, closedId]),
  );
  expect(response.body.requests.map(({ id }) => id)).not.toContain(hiddenId);
  expect(response.body.requests).toContainEqual(expect.objectContaining({
    id: closedId,
    status: 'closed',
    favoriteCount: expect.any(Number),
    reactionCount: expect.any(Number),
    applicationCount: expect.any(Number),
  }));
});

it('enforces owner request lifecycle transitions', async () => {
  const pendingId = insertRequest({ status: 'pending', title: 'Can withdraw' });
  const approvedId = insertRequest({ status: 'approved', title: 'Can close' });
  const rejectedId = insertRequest({ status: 'rejected', title: 'Can resubmit' });
  const strangerId = insertUser({ account: 'my-request-stranger' });

  const withdraw = await request(app)
    .post(`/api/my/requests/${pendingId}/withdraw`)
    .set(auth(users.qixiu));
  const withdrawApproved = await request(app)
    .post(`/api/my/requests/${approvedId}/withdraw`)
    .set(auth(users.qixiu));
  const close = await request(app)
    .post(`/api/my/requests/${approvedId}/close`)
    .set(auth(users.qixiu));
  const hide = await request(app)
    .post(`/api/my/requests/${approvedId}/hide`)
    .set(auth(users.qixiu));
  const stranger = await request(app)
    .post(`/api/my/requests/${rejectedId}/withdraw`)
    .set(auth(strangerId));

  expect(withdraw.body.request).toMatchObject({ id: pendingId, status: 'withdrawn' });
  expect(withdrawApproved.status).toBe(409);
  expect(close.body.request).toMatchObject({ id: approvedId, status: 'closed' });
  expect(hide.body).toEqual({ hidden: true });
  expect(stranger.status).toBe(404);
});

it('resubmits only withdrawn and rejected requests as pending', async () => {
  const withdrawnId = insertRequest({ status: 'withdrawn', title: 'Old withdrawn' });
  const approvedId = insertRequest({ status: 'approved', title: 'Published' });

  const resubmitted = await request(app)
    .put(`/api/my/requests/${withdrawnId}`)
    .set(auth(users.qixiu))
    .send({
      type: 'other',
      title: 'Updated request',
      city: 'Hangzhou',
      remote: false,
      industry: 'Technology',
      budgetOrReward: 'Coffee',
      expiresAt: FUTURE,
      details: validDetails('other', { requestKind: 'Updated kind' }),
    });
  const illegal = await request(app)
    .put(`/api/my/requests/${approvedId}`)
    .set(auth(users.qixiu))
    .send({
      type: 'other',
      title: 'Illegal update',
      city: 'Hangzhou',
      remote: false,
      expiresAt: FUTURE,
      details: validDetails('other'),
    });

  expect(resubmitted.status).toBe(200);
  expect(resubmitted.body.request).toMatchObject({
    id: withdrawnId,
    title: 'Updated request',
    status: 'pending',
    rejectReason: null,
  });
  expect(illegal.status).toBe(409);
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npm test -- tests/db.test.js tests/api.requests.test.js
```

Expected: FAIL because schema columns/statuses and `/api/my/requests` do not exist.

- [ ] **Step 4: Update schema and migration**

In `server/schema.sql`, add request statuses:

```sql
'withdrawn',
'closed',
```

and columns:

```sql
  withdrawnAt TEXT,
  closedAt TEXT,
  ownerHiddenAt TEXT,
```

In `server/db.js`, add column migrations:

```js
  for (const [name, definition] of [
    ['withdrawnAt', 'TEXT'],
    ['closedAt', 'TEXT'],
    ['ownerHiddenAt', 'TEXT'],
  ]) {
    if (!requestColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE requests ADD COLUMN ${name} ${definition}`);
    }
  }
```

If legacy SQLite CHECK constraints reject `withdrawn`/`closed`, rebuild `requests` inside `migrateDatabase(db)` by renaming the table, executing the new schema table creation, copying existing columns, and dropping the old table. Keep this rebuild inside a transaction and preserve all existing request fields.

- [ ] **Step 5: Update domain constants**

In `server/domain.js`, include:

```js
export const REQUEST_STATUSES = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'taken_down',
  'expired',
  'withdrawn',
  'closed',
];
```

- [ ] **Step 6: Create shared request payload helper**

Create `server/requestPayload.js` with the current create-route validation moved out of `server/routes/requests.js`. Export:

```js
export function buildRequestValuesFromBody(ownerId, body, { multipart = false } = {}) {
  // returns { ownerId, type, title, description, details, city, remote,
  // industry, budgetOrReward, expiresAt }
}
```

The helper must keep current validation messages for `type`, `title`, `details`, `remote`, `city or remote=true`, and `expiresAt`.

- [ ] **Step 7: Use shared helper in public create route**

In `server/routes/requests.js`, replace duplicated parsing with:

```js
const values = buildRequestValuesFromBody(req.user.id, body, { multipart });
```

Keep the trade-image-only check and insert logic unchanged.

- [ ] **Step 8: Implement owner-only router**

Create `server/routes/myRequests.js`. Use `requireUser(db)` and owner-only SQL:

```js
function loadOwnedRequest(db, id, ownerId) {
  return db.prepare(`${MY_REQUEST_QUERY} WHERE r.id = ? AND r.ownerId = ?`).get(id, ownerId);
}
```

List route must filter out `ownerHiddenAt IS NULL` by default and support `status`.

Transition routes:

```sql
UPDATE requests
SET status = 'withdrawn', withdrawnAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
WHERE id = ? AND ownerId = ? AND status = 'pending'
```

```sql
UPDATE requests
SET status = 'closed', closedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
WHERE id = ? AND ownerId = ? AND status = 'approved'
```

```sql
UPDATE requests
SET ownerHiddenAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
WHERE id = ? AND ownerId = ? AND status = 'closed'
```

Resubmit route must use `buildRequestValuesFromBody`, update the original row, set `status = 'pending'`, clear `rejectReason`, `withdrawnAt`, `closedAt`, `ownerHiddenAt`, and update `updatedAt`.

- [ ] **Step 9: Mount router**

In `server/app.js`:

```js
import { createMyRequestsRouter } from './routes/myRequests.js';
app.use('/api/my/requests', createMyRequestsRouter(db));
```

- [ ] **Step 10: Run targeted tests**

Run:

```bash
npm test -- tests/db.test.js tests/api.requests.test.js
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1**

Run:

```bash
git add server/schema.sql server/db.js server/domain.js server/requestPayload.js server/routes/requests.js server/routes/myRequests.js server/app.js tests/db.test.js tests/api.requests.test.js
git commit -m "feat: add owner request lifecycle API"
```

---

### Task 2: Admin Hard Delete and Status Visibility

**Files:**
- Modify: `server/routes/admin.js`
- Modify: `src/domain/constants.js`
- Modify: `src/pages/admin/AdminRequests.jsx`
- Test: `tests/api.requests.test.js`
- Test: `tests/ui.permissions.test.jsx`

**Interfaces:**
- Consumes `REQUEST_STATUSES` including `withdrawn` and `closed`.
- Produces `DELETE /api/admin/requests/:id` returning `{ deleted: true }`.
- Produces admin UI action `彻底删除委托`.

- [ ] **Step 1: Write failing admin hard-delete API test**

Add to `tests/api.requests.test.js`:

```js
it('lets admins hard delete requests and cascades request-owned records', async () => {
  const requestId = insertRequest({ status: 'closed', title: 'Delete me' });
  db.prepare('INSERT INTO request_reactions (userId, requestId) VALUES (?, ?)').run(users.wanhua, requestId);
  db.prepare('INSERT INTO favorites (userId, requestId) VALUES (?, ?)').run(users.wanhua, requestId);

  const nonAdmin = await request(app)
    .delete(`/api/admin/requests/${requestId}`)
    .set(auth(users.qixiu));
  const deleted = await request(app)
    .delete(`/api/admin/requests/${requestId}`)
    .set(auth(users.admin));
  const repeated = await request(app)
    .delete(`/api/admin/requests/${requestId}`)
    .set(auth(users.admin));

  expect(nonAdmin.status).toBe(403);
  expect(deleted.body).toEqual({ deleted: true });
  expect(repeated.status).toBe(404);
  expect(db.prepare('SELECT COUNT(*) AS count FROM requests WHERE id = ?').get(requestId).count).toBe(0);
  expect(db.prepare('SELECT COUNT(*) AS count FROM favorites WHERE requestId = ?').get(requestId).count).toBe(0);
  expect(db.prepare('SELECT COUNT(*) AS count FROM request_reactions WHERE requestId = ?').get(requestId).count).toBe(0);
});
```

- [ ] **Step 2: Write failing admin UI test**

Add to `tests/ui.permissions.test.jsx` near admin request action tests:

```jsx
it('hard deletes an admin request after confirmation text is entered', async () => {
  fetch
    .mockResolvedValueOnce(jsonResponse({ requests: [{ ...reviewedRequest, status: 'closed' }] }))
    .mockResolvedValueOnce(jsonResponse({ deleted: true }))
    .mockResolvedValueOnce(jsonResponse({ requests: [] }))
    .mockResolvedValueOnce(jsonResponse({ requests: [] }));
  const user = userEvent.setup();

  render(<AdminRequests />);

  await screen.findByRole('table', { name: '委托审核列表' });
  await user.type(screen.getByLabelText('委托 41 彻底删除确认'), '彻底删除');
  await user.click(screen.getByRole('button', { name: '彻底删除委托' }));

  expect(fetch).toHaveBeenNthCalledWith(
    2,
    '/api/admin/requests/41',
    expect.objectContaining({ method: 'DELETE' }),
  );
});
```

- [ ] **Step 3: Run targeted tests and verify failure**

Run:

```bash
npm test -- tests/api.requests.test.js tests/ui.permissions.test.jsx
```

Expected: FAIL because delete endpoint and UI control do not exist.

- [ ] **Step 4: Add backend hard delete**

In `server/routes/admin.js`, after request transition routes:

```js
router.delete('/requests/:id', (req, res, next) => {
  try {
    const id = positiveId(req.params.id);
    const result = db.prepare('DELETE FROM requests WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    return res.json({ deleted: true });
  } catch (error) {
    return next(error);
  }
});
```

- [ ] **Step 5: Add frontend labels**

In `src/domain/constants.js`, add:

```js
withdrawn: '已撤回',
closed: '已关闭',
```

- [ ] **Step 6: Add admin hard-delete UI**

In `src/pages/admin/AdminRequests.jsx`, add row-scoped confirmation state:

```jsx
const [deleteConfirmations, setDeleteConfirmations] = useState({});
```

Add input and danger button in row actions:

```jsx
<input
  aria-label={`委托 ${item.id} 彻底删除确认`}
  value={deleteConfirmations[item.id] ?? ''}
  onChange={(event) => setDeleteConfirmations((current) => ({ ...current, [item.id]: event.target.value }))}
/>
<button
  type="button"
  className="button-danger"
  disabled={deleteConfirmations[item.id] !== '彻底删除'}
  onClick={() => hardDelete(item.id)}
>
  彻底删除委托
</button>
```

Implement `hardDelete(id)` with `api(`/api/admin/requests/${id}`, { method: 'DELETE' })`, then refresh.

- [ ] **Step 7: Run targeted tests**

Run:

```bash
npm test -- tests/api.requests.test.js tests/ui.permissions.test.jsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add server/routes/admin.js src/domain/constants.js src/pages/admin/AdminRequests.jsx tests/api.requests.test.js tests/ui.permissions.test.jsx
git commit -m "feat: add admin hard delete for requests"
```

---

### Task 3: User “我的委托” Page and Navigation

**Files:**
- Create: `src/domain/myRequests.js`
- Create: `src/pages/MyRequestsPage.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/AppShell.jsx`
- Modify: `src/styles.css`
- Test: `tests/ui.permissions.test.jsx`

**Interfaces:**
- Consumes owner API from Task 1.
- Produces `MyRequestsPage({ onSelectRequest, onEditRequest, onCreateRequest })`.
- Produces app tab id `myRequests`.

- [ ] **Step 1: Write failing UI navigation/list tests**

Add to `tests/ui.permissions.test.jsx`:

```jsx
it('shows my requests navigation and lists owner request actions by status', async () => {
  fetch.mockResolvedValueOnce(jsonResponse({
    requests: [
      {
        id: 301,
        type: 'other',
        title: '待评审委托',
        status: 'pending',
        city: '杭州',
        remote: false,
        expiresAt: '2099-01-01T00:00:00.000Z',
        reactionCount: 1,
        favoriteCount: 2,
        applicationCount: 3,
      },
      {
        id: 302,
        type: 'other',
        title: '已发布委托',
        status: 'approved',
        city: '上海',
        remote: true,
        expiresAt: '2099-01-01T00:00:00.000Z',
        reactionCount: 0,
        favoriteCount: 0,
        applicationCount: 0,
      },
    ],
  }));

  render(<MyRequestsPage onSelectRequest={vi.fn()} onEditRequest={vi.fn()} onCreateRequest={vi.fn()} />);

  expect(await screen.findByRole('heading', { name: '我的委托' })).toBeVisible();
  expect(screen.getByRole('button', { name: '撤回委托：待评审委托' })).toBeVisible();
  expect(screen.getByRole('button', { name: '关闭委托：已发布委托' })).toBeVisible();
  expect(screen.getByText('联系申请 3')).toBeVisible();
});
```

- [ ] **Step 2: Write failing action tests**

Add:

```jsx
it('withdraws, closes, and hides owner requests from my requests page', async () => {
  fetch
    .mockResolvedValueOnce(jsonResponse({
      requests: [
        { id: 401, type: 'other', title: '待审', status: 'pending', expiresAt: '2099-01-01T00:00:00.000Z' },
        { id: 402, type: 'other', title: '发布中', status: 'approved', expiresAt: '2099-01-01T00:00:00.000Z' },
        { id: 403, type: 'other', title: '已关闭', status: 'closed', expiresAt: '2099-01-01T00:00:00.000Z' },
      ],
    }))
    .mockResolvedValueOnce(jsonResponse({ request: { id: 401, title: '待审', status: 'withdrawn' } }))
    .mockResolvedValueOnce(jsonResponse({ request: { id: 402, title: '发布中', status: 'closed' } }))
    .mockResolvedValueOnce(jsonResponse({ hidden: true }));
  const user = userEvent.setup();

  render(<MyRequestsPage onSelectRequest={vi.fn()} onEditRequest={vi.fn()} onCreateRequest={vi.fn()} />);

  await user.click(await screen.findByRole('button', { name: '撤回委托：待审' }));
  await user.click(screen.getByRole('button', { name: '关闭委托：发布中' }));
  await user.click(screen.getByRole('button', { name: '删除委托：已关闭' }));

  expect(fetch).toHaveBeenCalledWith('/api/my/requests/401/withdraw', expect.objectContaining({ method: 'POST' }));
  expect(fetch).toHaveBeenCalledWith('/api/my/requests/402/close', expect.objectContaining({ method: 'POST' }));
  expect(fetch).toHaveBeenCalledWith('/api/my/requests/403/hide', expect.objectContaining({ method: 'POST' }));
  expect(screen.queryByText('已关闭')).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test -- tests/ui.permissions.test.jsx
```

Expected: FAIL because page/nav do not exist.

- [ ] **Step 4: Create my request helpers**

Create `src/domain/myRequests.js`:

```js
export const myRequestFilters = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待评审' },
  { value: 'approved', label: '已发布' },
  { value: 'withdrawn', label: '已撤回' },
  { value: 'rejected', label: '未通过' },
  { value: 'closed', label: '已关闭' },
  { value: 'taken_down', label: '已下架' },
  { value: 'expired', label: '已过期' },
];

export function myRequestActions(request) {
  if (request.status === 'pending') return ['withdraw'];
  if (request.status === 'approved') return ['close'];
  if (['withdrawn', 'rejected'].includes(request.status)) return ['edit'];
  if (request.status === 'closed') return ['hide'];
  return [];
}
```

- [ ] **Step 5: Create page**

Create `src/pages/MyRequestsPage.jsx`. It must:

- load `/api/my/requests?status=${filter}` with abort handling,
- render filters,
- render cards with counts,
- call `POST /withdraw`, `POST /close`, `POST /hide`,
- update local rows after success,
- call `onSelectRequest(id)` for view,
- call `onEditRequest(id)` for edit.

- [ ] **Step 6: Add navigation and app routing**

In `src/components/AppShell.jsx`, add navigation:

```jsx
{ id: 'myRequests', label: '我的委托', Icon: ClipboardList }
```

In `src/App.jsx`, import and render:

```jsx
{visitedTabs.has('myRequests') && (
  <div hidden={activeTab !== 'myRequests'}>
    <MyRequestsPage
      onSelectRequest={setSelectedRequestId}
      onEditRequest={setEditingRequestId}
      onCreateRequest={() => handleTabChange('create')}
    />
  </div>
)}
```

Add `editingRequestId` state for Task 4.

- [ ] **Step 7: Add styles**

In `src/styles.css`, add `.my-requests-page`, `.my-request-card`, `.status-filter-bar`, and `.my-request-actions` using existing card/button tokens.

- [ ] **Step 8: Run targeted tests**

Run:

```bash
npm test -- tests/ui.permissions.test.jsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

Run:

```bash
git add src/domain/myRequests.js src/pages/MyRequestsPage.jsx src/App.jsx src/components/AppShell.jsx src/styles.css tests/ui.permissions.test.jsx
git commit -m "feat: add my requests management page"
```

---

### Task 4: Edit and Resubmit Existing Requests

**Files:**
- Modify: `src/pages/CreateRequestPage.jsx`
- Modify: `src/App.jsx`
- Test: `tests/ui.permissions.test.jsx`

**Interfaces:**
- Consumes `GET /api/my/requests/:id`.
- Consumes `PUT /api/my/requests/:id`.
- Produces `CreateRequestPage({ session, editRequestId, onEditComplete })`.

- [ ] **Step 1: Write failing edit/resubmit UI test**

Add to `tests/ui.permissions.test.jsx`:

```jsx
it('loads a withdrawn request into the create form and resubmits it', async () => {
  fetch
    .mockResolvedValueOnce(jsonResponse({
      request: {
        id: 501,
        type: 'other',
        title: '旧标题',
        city: '杭州',
        remote: false,
        industry: 'Technology',
        budgetOrReward: 'Coffee',
        expiresAt: '2099-01-01T00:00:00.000Z',
        status: 'withdrawn',
        details: {
          requestKind: '找同门',
          helpWanted: '一起做作品集',
          reward: '互相练习',
        },
      },
    }))
    .mockResolvedValueOnce(jsonResponse({ request: { id: 501, status: 'pending' } }));
  const onEditComplete = vi.fn();
  const user = userEvent.setup();

  render(
    <CreateRequestPage
      session={{ verificationStatus: 'approved' }}
      editRequestId={501}
      onEditComplete={onEditComplete}
    />,
  );

  expect(await screen.findByDisplayValue('旧标题')).toBeVisible();
  await user.clear(screen.getByLabelText('标题'));
  await user.type(screen.getByLabelText('标题'), '新标题');
  await user.click(screen.getByRole('button', { name: '重新提交审核' }));

  expect(fetch).toHaveBeenLastCalledWith(
    '/api/my/requests/501',
    expect.objectContaining({ method: 'PUT' }),
  );
  expect(onEditComplete).toHaveBeenCalledWith(501);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- tests/ui.permissions.test.jsx
```

Expected: FAIL because edit props are not implemented.

- [ ] **Step 3: Add edit loading to `CreateRequestPage`**

When `editRequestId` exists:

- load `/api/my/requests/:id`,
- set `form` from response,
- set `details`,
- set images to existing URLs as non-uploaded previews,
- change heading to `修改委托`,
- submit button text to `重新提交审核`,
- use `PUT /api/my/requests/:id` with JSON body, not multipart,
- do not include new file uploads in this first version.

The JSON submit body:

```js
{
  type: form.type,
  title: form.title.trim(),
  city: form.city.trim(),
  remote: form.remote,
  expiresAt: expiry.toISOString(),
  details: cleanDetails,
  industry: form.industry,
  budgetOrReward: form.budgetOrReward,
}
```

- [ ] **Step 4: Wire edit completion in `App.jsx`**

When `onEditComplete` fires:

```js
setEditingRequestId(null);
handleTabChange('myRequests');
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npm test -- tests/ui.permissions.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/pages/CreateRequestPage.jsx src/App.jsx tests/ui.permissions.test.jsx
git commit -m "feat: support resubmitting owned requests"
```

---

### Task 5: End-to-End Acceptance and PR Update

**Files:**
- Modify: `tests/e2e.spec.js`
- Test: full suite, build, e2e.

**Interfaces:**
- Consumes all previous tasks.

- [ ] **Step 1: Add E2E coverage**

Add to `tests/e2e.spec.js`:

```js
test('user manages their own requests', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('qixiu');
  await page.getByLabel('密码').fill('test123');
  await page.locator('form').getByRole('button', { name: '登录' }).click();

  await page.locator('.bottom-navigation').getByRole('button', { name: '我的委托' }).click();
  await expect(page.getByRole('heading', { name: '我的委托' })).toBeVisible();
  await expect(page.getByRole('button', { name: /撤回委托|关闭委托|修改后重新提交/ }).first()).toBeVisible();
});
```

If seed data does not contain the required statuses, extend `seedDatabase(db)` with one pending and one approved owned request for the e2e accounts.

- [ ] **Step 2: Verify no public visibility regression**

Run:

```bash
npm test -- tests/api.requests.test.js
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run build
npm run e2e
rg "复制重发" src server tests -n
git diff --check
```

Expected:

- `npm test`: all tests pass.
- `npm run build`: build succeeds.
- `npm run e2e`: all e2e tests pass.
- `rg "复制重发" src server tests -n`: no results.
- `git diff --check`: no whitespace errors.

- [ ] **Step 4: Commit Task 5**

Run:

```bash
git add tests/e2e.spec.js server/db.js
git commit -m "test: cover my requests workflow"
```

- [ ] **Step 5: Push branch and update PR**

Run:

```bash
git push origin codex/feed-discovery-v2
```

Update PR #2 body or comment with the new validation evidence.

---

## Final Acceptance Checklist

- [ ] 用户能从底部导航进入「我的委托」。
- [ ] 用户能看到自己发布的所有未隐藏委托，包括非公开状态。
- [ ] 用户能区分待评审、已发布、已撤回、未通过、已关闭、已下架、已过期。
- [ ] 待评审委托可以撤回。
- [ ] 已发布委托不能撤回，只能关闭。
- [ ] 撤回和关闭后委托不再进入万事广场。
- [ ] 撤回和未通过委托可以修改后重新提交审核。
- [ ] 关闭委托可以用户侧删除，删除后从我的委托列表消失，但数据库记录保留。
- [ ] 管理员可以彻底删除委托。
- [ ] 不做复制重发。
- [ ] `npm test`、`npm run build`、`npm run e2e` 全部通过。

## Self-Review

- Spec coverage: every spec section maps to Task 1 through Task 5.
- Placeholder scan: no unresolved markers, no deferred implementation within scope, and all task interfaces are named.
- Type consistency: request statuses are consistently `withdrawn` and `closed`; soft delete is consistently `ownerHiddenAt`; owner APIs consistently use `/api/my/requests`.
