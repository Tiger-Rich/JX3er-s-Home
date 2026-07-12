# Request Type Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade requests from one generic description form into six typed request forms with structured `details`, trade image upload/display, and anti-fraud reminders.

**Architecture:** Add a typed request-details domain module shared conceptually by server and client. Keep the existing `requests.description` field as a server-generated summary for list/detail/admin compatibility, and add `requests.details` plus `request_images` for structured payloads and trade images. Use `multipart/form-data` only for request creation so trade images and typed fields are submitted atomically.

**Tech Stack:** React 19, Vite 8, Express 5, SQLite via better-sqlite3, Vitest, Testing Library, Playwright, `multer` for multipart image parsing.

## Global Constraints

- Request types are exactly `job_referral`, `industry_consulting`, `trade`, `commission`, `local_help`, `other`.
- `fandom_help` is retired and must not appear in create forms, filters, domain constants, or new API writes.
- The create form no longer exposes required generic "委托说明"; all types keep optional "补充说明".
- `requests.description` remains in the API and database as a server-generated 1-3 sentence summary.
- `requests.details` stores JSON as text and must be returned as an object in public and admin DTOs.
- Trade requests may have 0-6 images; each image is at most 5MB and must be JPG, PNG, or WebP.
- Images are only accepted for `trade`; non-trade image submissions return 400.
- Details pages show a general anti-fraud reminder before contact actions; trade details show an extra trade risk reminder.
- Existing auth, verification, contact application, favorite, report, admin review, disabled-user, and expiry rules remain intact.
- All implementation follows TDD: write/adjust failing tests first, then implementation, then full verification.

---

## File Structure

- Modify `package.json` and `package-lock.json`: add `multer`.
- Modify `.gitignore`: ignore local uploaded request images.
- Modify `server/schema.sql`: add `requests.details` and `request_images`.
- Modify `server/domain.js`: remove `fandom_help` from `REQUEST_TYPES`.
- Create `server/requestDetails.js`: server-side details schema, validation, normalization, summary generation, JSON parsing.
- Create `server/requestImages.js`: upload directory constants, file validation helpers, image DTO helpers, DB insert/load helpers.
- Modify `server/app.js`: serve uploaded images from a static route and wire upload errors into JSON responses.
- Modify `server/routes/requests.js`: accept multipart create requests, validate details, generate description, store images, return `details/images`.
- Modify `server/routes/admin.js`: include `details/images` in admin request list and transition responses.
- Modify `src/domain/constants.js`: remove `fandom_help`, add request detail field config labels for the client.
- Create `src/domain/requestDetails.js`: client field definitions, empty detail creation, details-to-summary labels, type-specific validation.
- Modify `src/api/client.js`: support both JSON bodies and `FormData`.
- Modify `src/pages/CreateRequestPage.jsx`: dynamic typed fields, optional extra note, trade image upload/preview/delete, multipart submit.
- Modify `src/pages/FeedPage.jsx`: remove retired type from filters, show description and only show industry when present.
- Modify `src/pages/RequestDetailPage.jsx`: render typed details, trade images, and anti-fraud reminders before contact actions.
- Modify `src/pages/admin/AdminRequests.jsx`: render typed details and trade image thumbnails in the review table.
- Modify `src/styles.css`: styles for typed form sections, upload grid, image thumbnails, risk notices.
- Modify `tests/domain.test.js`, `tests/db.test.js`, `tests/api.requests.test.js`, `tests/ui.permissions.test.jsx`, `tests/e2e.spec.js`: coverage for the new contract and UI behavior.

---

### Task 1: Domain Constants, Schema, And Details Helpers

**Files:**
- Modify: `server/domain.js`
- Modify: `src/domain/constants.js`
- Modify: `server/schema.sql`
- Create: `server/requestDetails.js`
- Test: `tests/domain.test.js`
- Test: `tests/db.test.js`
- Test: `tests/api.requests.test.js`

**Interfaces:**
- Produces: `REQUEST_DETAIL_SCHEMAS`, `normalizeRequestDetails(type, rawDetails)`, `buildRequestDescription(type, details)`, `parseRequestDetails(value)`, `requestIndustry(type, details, fallback)`
- Consumes: existing `REQUEST_TYPES`

- [ ] **Step 1: Write failing domain tests for the retired type**

Update `tests/domain.test.js` so request types no longer include `fandom_help`:

```js
expect(REQUEST_TYPES).toEqual({
  job_referral: '求职内推',
  industry_consulting: '行业咨询',
  trade: '买卖交易',
  commission: '约稿委托',
  local_help: '本地互助',
  other: '其他',
});
expect(requestTypes).toEqual([
  { value: 'job_referral', label: '求职内推' },
  { value: 'industry_consulting', label: '行业咨询' },
  { value: 'trade', label: '买卖交易' },
  { value: 'commission', label: '约稿委托' },
  { value: 'local_help', label: '本地互助' },
  { value: 'other', label: '其他' },
]);
expect(JSON.stringify({ REQUEST_TYPES, requestTypes })).not.toContain('fandom_help');
expect(JSON.stringify({ REQUEST_TYPES, requestTypes })).not.toContain('追星互助');
```

- [ ] **Step 2: Write failing DB tests for schema changes**

Add assertions in `tests/db.test.js`:

```js
const requestColumns = db.prepare('PRAGMA table_info(requests)').all();
expect(requestColumns.map(({ name }) => name)).toContain('details');

const imageColumns = db.prepare('PRAGMA table_info(request_images)').all();
expect(imageColumns.map(({ name }) => name)).toEqual([
  'id',
  'requestId',
  'url',
  'mimeType',
  'sizeBytes',
  'sortOrder',
  'createdAt',
]);

expect(() =>
  db.prepare(
    "INSERT INTO requests (ownerId, type, title, description, details, expiresAt) VALUES (1, 'fandom_help', 'Bad type', 'Rejected', '{}', '2027-01-01 00:00:00')",
  ).run(),
).toThrow();
```

- [ ] **Step 3: Write failing API tests for details validation**

In `tests/api.requests.test.js`, add helper payloads:

```js
const validDetails = {
  job_referral: {
    targetRole: '产品经理',
    targetIndustry: '游戏互联网',
    careerStage: '3年经验，看新机会',
    helpWanted: '希望获得内推和简历建议',
    extraNote: '同门方便的话想先文字聊聊',
  },
  industry_consulting: {
    topic: '游戏行业产品岗位',
    questions: '想了解日常分工和面试准备',
    preferredFormat: '微信文字或语音',
  },
  trade: {
    itemName: '自家红薯礼盒',
    price: '68元/箱',
    condition: '新鲜现挖，5斤装',
    deliveryMethod: '快递发货',
    negotiable: '不议价',
  },
  commission: {
    commissionContent: '头像约稿',
    deliverables: '一张头像成图',
    budget: '300元',
    deadline: '两周内',
  },
  local_help: {
    helpTask: '周末看展搭子',
    area: '上海徐汇',
    timeWindow: '周六下午',
    headcount: '1人',
  },
  other: {
    requestKind: '资源对接',
    helpWanted: '想认识做线下活动的同门',
    reward: '请咖啡',
  },
};
```

Add tests:

```js
it.each(Object.entries(validDetails))('publishes %s with typed details', async (type, details) => {
  const response = await publish(users.qixiu, { type, details, description: 'client text is ignored' });

  expect(response.status).toBe(201);
  expect(response.body.request).toMatchObject({
    type,
    details: expect.objectContaining(details),
    description: expect.any(String),
  });
  expect(response.body.request.description).not.toBe('client text is ignored');
});

it('rejects retired fandom_help requests', async () => {
  const response = await publish(users.qixiu, {
    type: 'fandom_help',
    details: { requestKind: '追星互助', helpWanted: '帮忙', reward: '感谢' },
  });

  expect(response.status).toBe(400);
});

it('rejects missing required typed details', async () => {
  const response = await publish(users.qixiu, {
    type: 'trade',
    details: { itemName: '红薯礼盒' },
  });

  expect(response.status).toBe(400);
  expect(response.body.error).toContain('price is required');
});
```

- [ ] **Step 3a: Update existing request test helpers for the new contract**

Move `validDetails` above the existing `publish()` helper, then update `publish()` so all existing publication tests still send valid typed details:

```js
async function publish(ownerId = users.qixiu, overrides = {}) {
  const type = overrides.type ?? 'commission';
  return request(app)
    .post('/api/requests')
    .set(auth(ownerId))
    .send({
      type,
      title: 'Need a portfolio review',
      city: 'Hangzhou',
      remote: false,
      industry: 'Design',
      budgetOrReward: 'Coffee',
      expiresAt: FUTURE,
      details: validDetails[type] ?? validDetails.commission,
      anonymous: true,
      ...overrides,
    });
}
```

Also update any direct `INSERT INTO requests` helpers to pass `details` when the test needs structured DTO assertions:

```js
details = '{}',
```

and include `details` in the insert column/value list:

```sql
(ownerId, type, title, description, details, city, remote, industry,
 budgetOrReward, expiresAt, status)
VALUES (?, ?, ?, 'Detailed request', ?, ?, ?, ?, 'Coffee', ?, ?)
```

- [ ] **Step 4: Run the focused failing tests**

Run:

```bash
npm test -- tests/domain.test.js tests/db.test.js tests/api.requests.test.js
```

Expected: FAIL because constants, schema, and helpers are not implemented yet.

- [ ] **Step 5: Implement constants and schema**

Change `server/domain.js` and `src/domain/constants.js` to remove `fandom_help`.

Change `server/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ownerId INTEGER NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN (
      'job_referral',
      'industry_consulting',
      'trade',
      'commission',
      'local_help',
      'other'
    )),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  city TEXT,
  remote INTEGER NOT NULL DEFAULT 0 CHECK (remote IN (0, 1)),
  industry TEXT,
  budgetOrReward TEXT,
  expiresAt TEXT NOT NULL CHECK (datetime(expiresAt) IS NOT NULL),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'pending',
      'approved',
      'rejected',
      'taken_down',
      'expired'
    )),
  rejectReason TEXT,
  takedownReason TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, ownerId),
  FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS request_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requestId INTEGER NOT NULL,
  url TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  sizeBytes INTEGER NOT NULL,
  sortOrder INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (requestId) REFERENCES requests(id) ON DELETE CASCADE
);
```

Because `CREATE TABLE IF NOT EXISTS` does not migrate existing local DBs, also add a migration block in `createDatabase()` after `db.exec(schema)`:

```js
const requestColumns = db.prepare('PRAGMA table_info(requests)').all().map(({ name }) => name);
if (!requestColumns.includes('details')) {
  db.prepare("ALTER TABLE requests ADD COLUMN details TEXT NOT NULL DEFAULT '{}'").run();
}
```

- [ ] **Step 6: Create `server/requestDetails.js`**

Implement:

```js
import { REQUEST_TYPES } from './domain.js';

export const REQUEST_DETAIL_SCHEMAS = {
  job_referral: {
    required: ['targetRole', 'targetIndustry', 'careerStage', 'helpWanted'],
    optional: ['targetCompany', 'resumeHighlights', 'extraNote'],
    summary: [
      ['目标岗位', 'targetRole'],
      ['目标行业', 'targetIndustry'],
      ['当前阶段', 'careerStage'],
      ['希望获得', 'helpWanted'],
    ],
    industryField: 'targetIndustry',
  },
  industry_consulting: {
    required: ['topic', 'questions', 'preferredFormat'],
    optional: ['background', 'expectedPeer', 'reward', 'extraNote'],
    summary: [
      ['咨询方向', 'topic'],
      ['具体问题', 'questions'],
      ['交流方式', 'preferredFormat'],
    ],
    industryField: 'topic',
  },
  trade: {
    required: ['itemName', 'price', 'condition', 'deliveryMethod'],
    optional: ['negotiable', 'afterSalesBoundary', 'extraNote'],
    summary: [
      ['物品', 'itemName'],
      ['价格', 'price'],
      ['成色/规格', 'condition'],
      ['交易方式', 'deliveryMethod'],
    ],
  },
  commission: {
    required: ['commissionContent', 'deliverables', 'budget', 'deadline'],
    optional: ['styleReference', 'usage', 'commercialUse', 'extraNote'],
    summary: [
      ['委托内容', 'commissionContent'],
      ['交付物', 'deliverables'],
      ['预算', 'budget'],
      ['交付时间', 'deadline'],
    ],
  },
  local_help: {
    required: ['helpTask', 'area', 'timeWindow', 'headcount'],
    optional: ['costShare', 'safetyNote', 'extraNote'],
    summary: [
      ['互助事项', 'helpTask'],
      ['地点', 'area'],
      ['时间', 'timeWindow'],
      ['人数', 'headcount'],
    ],
  },
  other: {
    required: ['requestKind', 'helpWanted', 'reward'],
    optional: ['background', 'constraints', 'extraNote'],
    summary: [
      ['事情类型', 'requestKind'],
      ['希望帮助', 'helpWanted'],
      ['回报方式', 'reward'],
    ],
  },
};

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.exposeToClient = true;
  return error;
}

function cleanText(value, field, required) {
  if (value === undefined || value === null) {
    if (required) throw clientError(400, `${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw clientError(400, `${field} must be a string`);
  const normalized = value.trim();
  if (!normalized && required) throw clientError(400, `${field} is required`);
  if (normalized.length > 800) throw clientError(400, `${field} must be at most 800 characters`);
  return normalized || null;
}

export function normalizeRequestDetails(type, rawDetails) {
  if (!Object.hasOwn(REQUEST_TYPES, type) || !REQUEST_DETAIL_SCHEMAS[type]) {
    throw clientError(400, 'Invalid request type');
  }
  if (!rawDetails || typeof rawDetails !== 'object' || Array.isArray(rawDetails)) {
    throw clientError(400, 'details must be an object');
  }
  const schema = REQUEST_DETAIL_SCHEMAS[type];
  const result = {};
  for (const field of schema.required) result[field] = cleanText(rawDetails[field], field, true);
  for (const field of schema.optional) {
    const value = cleanText(rawDetails[field], field, false);
    if (value) result[field] = value;
  }
  return result;
}

export function buildRequestDescription(type, details) {
  const schema = REQUEST_DETAIL_SCHEMAS[type];
  const parts = schema.summary
    .map(([label, field]) => (details[field] ? `${label}：${details[field]}` : null))
    .filter(Boolean);
  if (details.extraNote) parts.push(`补充说明：${details.extraNote}`);
  return parts.slice(0, 5).join('；');
}

export function parseRequestDetails(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function requestIndustry(type, details, fallback = null) {
  const field = REQUEST_DETAIL_SCHEMAS[type]?.industryField;
  return field && details[field] ? details[field] : fallback;
}
```

- [ ] **Step 7: Wire helpers into request creation DTOs**

Modify `server/routes/requests.js` imports:

```js
import {
  buildRequestDescription,
  normalizeRequestDetails,
  parseRequestDetails,
  requestIndustry,
} from '../requestDetails.js';
```

Update `requestDto(row)` to include:

```js
details: parseRequestDetails(row.details),
images: row.images ?? [],
```

Update insert SQL and selected columns to include `details`.

- [ ] **Step 8: Run focused tests**

Run:

```bash
npm test -- tests/domain.test.js tests/db.test.js tests/api.requests.test.js
```

Expected: PASS for constants/schema/details validation tests added in this task, with image-specific tests still pending later tasks.

- [ ] **Step 9: Commit**

```bash
git add server/domain.js src/domain/constants.js server/schema.sql server/db.js server/requestDetails.js server/routes/requests.js tests/domain.test.js tests/db.test.js tests/api.requests.test.js
git commit -m "feat: add typed request details contract"
```

---

### Task 2: Multipart Trade Image Storage And API DTOs

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Modify: `server/app.js`
- Create: `server/requestImages.js`
- Modify: `server/routes/requests.js`
- Modify: `server/routes/admin.js`
- Test: `tests/api.requests.test.js`

**Interfaces:**
- Produces: `requestImageUpload`, `MAX_TRADE_IMAGES`, `REQUEST_IMAGE_ROUTE`, `insertRequestImages(db, requestId, files)`, `loadImagesForRequests(db, requestIds)`
- Consumes: `normalizeRequestDetails()` and request insert flow from Task 1

- [ ] **Step 1: Install multipart parser**

Run:

```bash
npm install multer
```

Expected: `package.json` and `package-lock.json` include `multer`.

- [ ] **Step 2: Write failing image API tests**

In `tests/api.requests.test.js`, add a helper:

```js
function multipartPublish(ownerId, fields, files = []) {
  const call = request(app).post('/api/requests').set(auth(ownerId));
  for (const [key, value] of Object.entries(fields)) {
    call.field(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  for (const file of files) {
    call.attach('images', Buffer.from(file.content), {
      filename: file.filename,
      contentType: file.contentType,
    });
  }
  return call;
}
```

Add tests:

```js
it('publishes trade images and returns them in public and admin DTOs', async () => {
  const response = await multipartPublish(users.qixiu, {
    type: 'trade',
    title: '自家红薯礼盒',
    city: '杭州',
    remote: 'false',
    expiresAt: FUTURE,
    details: validDetails.trade,
  }, [
    { filename: 'sweet-potato.png', contentType: 'image/png', content: 'fake png bytes' },
  ]);

  expect(response.status).toBe(201);
  expect(response.body.request.images).toHaveLength(1);
  expect(response.body.request.images[0]).toMatchObject({
    mimeType: 'image/png',
    sizeBytes: expect.any(Number),
    sortOrder: 0,
  });

  await request(app).post(`/api/admin/requests/${response.body.request.id}/approve`).set(auth(users.admin));
  const detail = await request(app).get(`/api/requests/${response.body.request.id}`);
  expect(detail.body.request.images).toHaveLength(1);

  const adminList = await request(app).get('/api/admin/requests').set(auth(users.admin));
  expect(adminList.body.requests.find((item) => item.id === response.body.request.id).images).toHaveLength(1);
});

it('rejects images for non-trade requests', async () => {
  const response = await multipartPublish(users.qixiu, {
    type: 'commission',
    title: '头像约稿',
    city: '杭州',
    remote: 'true',
    expiresAt: FUTURE,
    details: validDetails.commission,
  }, [
    { filename: 'ref.png', contentType: 'image/png', content: 'fake png bytes' },
  ]);

  expect(response.status).toBe(400);
});

it('rejects invalid image type and too many images', async () => {
  const invalidType = await multipartPublish(users.qixiu, {
    type: 'trade',
    title: '自家红薯礼盒',
    city: '杭州',
    remote: 'false',
    expiresAt: FUTURE,
    details: validDetails.trade,
  }, [
    { filename: 'note.txt', contentType: 'text/plain', content: 'not image' },
  ]);

  const tooMany = await multipartPublish(users.qixiu, {
    type: 'trade',
    title: '自家红薯礼盒',
    city: '杭州',
    remote: 'false',
    expiresAt: FUTURE,
    details: validDetails.trade,
  }, Array.from({ length: 7 }, (_, index) => ({
    filename: `image-${index}.png`,
    contentType: 'image/png',
    content: 'fake png bytes',
  })));

  expect(invalidType.status).toBe(400);
  expect(tooMany.status).toBe(400);
});
```

- [ ] **Step 3: Run failing image tests**

Run:

```bash
npm test -- tests/api.requests.test.js
```

Expected: FAIL because multipart parsing and images do not exist.

- [ ] **Step 4: Ignore upload artifacts**

Modify `.gitignore`:

```gitignore
uploads/
```

- [ ] **Step 5: Create `server/requestImages.js`**

Implement:

```js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import multer from 'multer';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const REQUEST_IMAGE_ROUTE = '/uploads/request-images';
export const REQUEST_IMAGE_DIRECTORY = path.resolve(moduleDirectory, '..', 'uploads', 'request-images');
export const MAX_TRADE_IMAGES = 6;
export const MAX_TRADE_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

fs.mkdirSync(REQUEST_IMAGE_DIRECTORY, { recursive: true });

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.exposeToClient = true;
  return error;
}

const extensionByMime = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, REQUEST_IMAGE_DIRECTORY),
  filename: (_req, file, callback) => {
    callback(null, `${crypto.randomUUID()}${extensionByMime[file.mimetype] ?? ''}`);
  },
});

export const requestImageUpload = multer({
  storage,
  limits: {
    files: MAX_TRADE_IMAGES,
    fileSize: MAX_TRADE_IMAGE_BYTES,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      callback(clientError(400, 'images must be JPG, PNG, or WebP'));
      return;
    }
    callback(null, true);
  },
}).array('images', MAX_TRADE_IMAGES);

export function requestImageDto(row) {
  return {
    id: row.id,
    requestId: row.requestId,
    url: row.url,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sortOrder: row.sortOrder,
  };
}

export function insertRequestImages(db, requestId, files) {
  const insert = db.prepare(
    `INSERT INTO request_images (requestId, url, mimeType, sizeBytes, sortOrder)
     VALUES (?, ?, ?, ?, ?)`,
  );
  files.forEach((file, index) => {
    const url = `${REQUEST_IMAGE_ROUTE}/${path.basename(file.path)}`;
    insert.run(requestId, url, file.mimetype, file.size, index);
  });
}

export function loadImagesForRequests(db, requestIds) {
  const uniqueIds = [...new Set(requestIds)].filter(Number.isInteger);
  if (!uniqueIds.length) return new Map();
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, requestId, url, mimeType, sizeBytes, sortOrder
       FROM request_images
       WHERE requestId IN (${placeholders})
       ORDER BY requestId, sortOrder, id`,
    )
    .all(...uniqueIds);
  const byRequest = new Map(uniqueIds.map((id) => [id, []]));
  for (const row of rows) byRequest.get(row.requestId)?.push(requestImageDto(row));
  return byRequest;
}
```

- [ ] **Step 6: Serve images and map multer errors**

Modify `server/app.js`:

```js
import { REQUEST_IMAGE_DIRECTORY, REQUEST_IMAGE_ROUTE } from './requestImages.js';
```

Add before API routes:

```js
app.use(REQUEST_IMAGE_ROUTE, express.static(REQUEST_IMAGE_DIRECTORY));
```

Add error handling:

```js
if (error?.code === 'LIMIT_FILE_SIZE') {
  return res.status(400).json({ error: 'each image must be at most 5MB' });
}
if (error?.code === 'LIMIT_FILE_COUNT' || error?.code === 'LIMIT_UNEXPECTED_FILE') {
  return res.status(400).json({ error: 'at most 6 images are allowed' });
}
```

- [ ] **Step 7: Make create route accept JSON and multipart**

In `server/routes/requests.js`, add a small middleware only on `POST /`:

```js
function parseMultipartCreate(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  return requestImageUpload(req, res, next);
}
```

Normalize body:

```js
function parseMaybeJson(value, fallback) {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function booleanFromBody(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false' || value === undefined) return false;
  throw clientError(400, 'remote must be a boolean');
}
```

Inside create handler:

```js
const details = normalizeRequestDetails(type, parseMaybeJson(body.details, null));
const files = req.files ?? [];
if (files.length && type !== 'trade') throw clientError(400, 'images are only supported for trade requests');
if (files.length > MAX_TRADE_IMAGES) throw clientError(400, 'at most 6 images are allowed');
const description = buildRequestDescription(type, details);
const industry = requestIndustry(type, details, optionalText(body.industry, 'industry', 120));
```

Use a transaction:

```js
const createRequest = db.transaction((values, filesToStore) => {
  const result = insertRequest.run(values);
  const requestId = Number(result.lastInsertRowid);
  insertRequestImages(db, requestId, filesToStore);
  return requestId;
});
```

- [ ] **Step 8: Load images for public and admin DTOs**

For list endpoints, after rows load:

```js
const imagesByRequest = loadImagesForRequests(db, rows.map(({ id }) => id));
return res.json({
  requests: rows.map((row) => requestDto({ ...row, images: imagesByRequest.get(row.id) ?? [] })),
});
```

For detail endpoint:

```js
const images = loadImagesForRequests(db, [row.id]).get(row.id) ?? [];
return res.json({ request: requestDto({ ...row, images }) });
```

Apply the same pattern to `server/routes/admin.js` for admin request lists and transition responses.

- [ ] **Step 9: Run focused tests**

Run:

```bash
npm test -- tests/api.requests.test.js
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json .gitignore server/app.js server/requestImages.js server/routes/requests.js server/routes/admin.js tests/api.requests.test.js
git commit -m "feat: support trade request images"
```

---

### Task 3: Client Request Details Config, FormData API, And Create Form

**Files:**
- Create: `src/domain/requestDetails.js`
- Modify: `src/api/client.js`
- Modify: `src/pages/CreateRequestPage.jsx`
- Modify: `src/styles.css`
- Test: `tests/ui.permissions.test.jsx`

**Interfaces:**
- Produces: `requestDetailSchemas`, `emptyDetailsForType(type)`, `validateDetails(type, details)`
- Consumes: API multipart contract from Task 2

- [ ] **Step 1: Write failing UI tests for dynamic fields and retired type**

In `tests/ui.permissions.test.jsx`, add tests for `CreateRequestPage`:

```jsx
it('shows six request types and no retired fandom option', () => {
  render(<CreateRequestPage session={{ verificationStatus: 'approved' }} />);

  const typeSelect = screen.getByLabelText('类型');
  expect(within(typeSelect).queryByRole('option', { name: '追星互助' })).not.toBeInTheDocument();
  expect(within(typeSelect).getAllByRole('option')).toHaveLength(6);
});

it('switches typed request fields and keeps optional extra note', async () => {
  const user = userEvent.setup();
  render(<CreateRequestPage session={{ verificationStatus: 'approved' }} />);

  expect(screen.queryByLabelText('委托说明')).not.toBeInTheDocument();
  expect(screen.getByLabelText('目标岗位')).toBeVisible();
  expect(screen.getByLabelText('补充说明（选填）')).toBeVisible();

  await user.selectOptions(screen.getByLabelText('类型'), 'trade');
  expect(screen.getByLabelText('物品/服务名称')).toBeVisible();
  expect(screen.getByLabelText('价格或交换方式')).toBeVisible();
  expect(screen.getByLabelText('交易/发货方式')).toBeVisible();
  expect(screen.getByLabelText('买卖交易图片')).toBeVisible();
});

it('previews and removes trade images before submit', async () => {
  const user = userEvent.setup();
  render(<CreateRequestPage session={{ verificationStatus: 'approved' }} />);

  await user.selectOptions(screen.getByLabelText('类型'), 'trade');
  const file = new File(['image'], 'sweet-potato.png', { type: 'image/png' });
  await user.upload(screen.getByLabelText('买卖交易图片'), file);

  expect(screen.getByAltText('sweet-potato.png')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '移除图片：sweet-potato.png' }));
  expect(screen.queryByAltText('sweet-potato.png')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Write failing API client test for FormData**

In the API client tests:

```js
it('sends FormData without forcing a JSON content type', async () => {
  fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
  const formData = new FormData();
  formData.append('title', 'typed request');

  await api('/api/requests', { method: 'POST', body: formData });

  expect(fetch).toHaveBeenCalledWith('/api/requests', expect.objectContaining({
    method: 'POST',
    body: formData,
    headers: expect.not.objectContaining({ 'Content-Type': expect.any(String) }),
  }));
});
```

- [ ] **Step 3: Run focused failing UI tests**

Run:

```bash
npm test -- tests/ui.permissions.test.jsx
```

Expected: FAIL because dynamic fields and FormData support are missing.

- [ ] **Step 4: Create client details config**

Create `src/domain/requestDetails.js`:

```js
export const requestDetailSchemas = {
  job_referral: [
    { name: 'targetRole', label: '目标岗位', required: true },
    { name: 'targetIndustry', label: '目标行业', required: true },
    { name: 'careerStage', label: '当前阶段', required: true },
    { name: 'helpWanted', label: '希望获得的帮助', required: true, multiline: true },
    { name: 'targetCompany', label: '期望公司/方向', required: false },
    { name: 'resumeHighlights', label: '简历亮点', required: false, multiline: true },
  ],
  industry_consulting: [
    { name: 'topic', label: '咨询方向', required: true },
    { name: 'questions', label: '具体问题', required: true, multiline: true },
    { name: 'preferredFormat', label: '期望交流方式', required: true },
    { name: 'background', label: '我的背景', required: false, multiline: true },
    { name: 'expectedPeer', label: '希望对方资历', required: false },
    { name: 'reward', label: '可提供回报', required: false },
  ],
  trade: [
    { name: 'itemName', label: '物品/服务名称', required: true },
    { name: 'price', label: '价格或交换方式', required: true },
    { name: 'condition', label: '成色/规格', required: true },
    { name: 'deliveryMethod', label: '交易/发货方式', required: true },
    { name: 'negotiable', label: '是否可议价', required: false },
    { name: 'afterSalesBoundary', label: '售后边界', required: false, multiline: true },
  ],
  commission: [
    { name: 'commissionContent', label: '委托内容', required: true, multiline: true },
    { name: 'deliverables', label: '交付物', required: true },
    { name: 'budget', label: '预算', required: true },
    { name: 'deadline', label: '期望交付时间', required: true },
    { name: 'styleReference', label: '风格参考', required: false, multiline: true },
    { name: 'usage', label: '使用场景', required: false },
    { name: 'commercialUse', label: '商用/非商用', required: false },
  ],
  local_help: [
    { name: 'helpTask', label: '互助事项', required: true, multiline: true },
    { name: 'area', label: '地点/区域', required: true },
    { name: 'timeWindow', label: '时间窗口', required: true },
    { name: 'headcount', label: '需要几人', required: true },
    { name: 'costShare', label: '费用 AA/回报', required: false },
    { name: 'safetyNote', label: '安全注意事项', required: false, multiline: true },
  ],
  other: [
    { name: 'requestKind', label: '事情类型', required: true },
    { name: 'helpWanted', label: '希望对方怎么帮', required: true, multiline: true },
    { name: 'reward', label: '回报方式', required: true },
    { name: 'background', label: '背景说明', required: false, multiline: true },
    { name: 'constraints', label: '限制条件', required: false, multiline: true },
  ],
};

export function emptyDetailsForType(type) {
  return Object.fromEntries([
    ...(requestDetailSchemas[type] ?? []).map((field) => [field.name, '']),
    ['extraNote', ''],
  ]);
}

export function validateDetails(type, details) {
  for (const field of requestDetailSchemas[type] ?? []) {
    if (field.required && !details[field.name]?.trim()) return `${field.label}为必填`;
  }
  return '';
}
```

- [ ] **Step 5: Support FormData in `src/api/client.js`**

Change body handling:

```js
const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';
```

Change fetch body:

```js
...(body === undefined ? {} : { body: isFormData ? body : JSON.stringify(body) }),
```

- [ ] **Step 6: Rebuild `CreateRequestPage` form state**

Use:

```js
const initialForm = {
  type: 'job_referral',
  title: '',
  city: '',
  remote: false,
  expiresAt: '',
};
const [details, setDetails] = useState(() => emptyDetailsForType(initialForm.type));
const [images, setImages] = useState([]);
```

On type change:

```js
if (name === 'type') {
  setForm((current) => ({ ...current, type: value }));
  setDetails(emptyDetailsForType(value));
  setImages([]);
  setFeedback(null);
  return;
}
```

Image validation:

```js
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
function updateImages(event) {
  const selected = [...event.target.files];
  if (images.length + selected.length > 6) {
    setFeedback({ type: 'error', message: '买卖交易最多上传 6 张图片。' });
    return;
  }
  const invalid = selected.find((file) => !allowedImageTypes.has(file.type) || file.size > 5 * 1024 * 1024);
  if (invalid) {
    setFeedback({ type: 'error', message: '图片需为 JPG/PNG/WebP，且单张不超过 5MB。' });
    return;
  }
  setImages((current) => [...current, ...selected]);
}
```

Submit with FormData:

```js
const payload = new FormData();
payload.append('type', form.type);
payload.append('title', form.title.trim());
payload.append('city', form.city.trim());
payload.append('remote', String(form.remote));
payload.append('expiresAt', expiry.toISOString());
payload.append('details', JSON.stringify(cleanDetails));
for (const image of images) payload.append('images', image);
await api('/api/requests', { method: 'POST', signal: controller.signal, body: payload });
```

- [ ] **Step 7: Render dynamic fields and upload UI**

Render fields from `requestDetailSchemas[form.type]`, then:

```jsx
<label>
  补充说明（选填）
  <textarea name="extraNote" value={details.extraNote} onChange={updateDetail} maxLength={800} />
</label>
```

For trade:

```jsx
{form.type === 'trade' && (
  <div className="image-upload-field">
    <label>
      买卖交易图片
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={updateImages} />
    </label>
    <div className="image-preview-grid">
      {images.map((image, index) => (
        <figure key={`${image.name}-${index}`}>
          <img src={URL.createObjectURL(image)} alt={image.name} />
          <button type="button" onClick={() => removeImage(index)} aria-label={`移除图片：${image.name}`}>移除</button>
        </figure>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 8: Add styles**

Add classes:

```css
.typed-fields {
  display: grid;
  gap: 14px;
}

.image-upload-field {
  display: grid;
  gap: 12px;
}

.image-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
}

.image-preview-grid figure {
  margin: 0;
}

.image-preview-grid img,
.request-image-grid img,
.admin-request-image-grid img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 8px;
}
```

- [ ] **Step 9: Run focused UI tests**

Run:

```bash
npm test -- tests/ui.permissions.test.jsx
```

Expected: PASS for dynamic form and FormData tests.

- [ ] **Step 10: Commit**

```bash
git add src/domain/requestDetails.js src/api/client.js src/pages/CreateRequestPage.jsx src/styles.css tests/ui.permissions.test.jsx
git commit -m "feat: add typed request create form"
```

---

### Task 4: Public Detail, Feed, Admin Review, And Risk Notices

**Files:**
- Modify: `src/pages/FeedPage.jsx`
- Modify: `src/pages/RequestDetailPage.jsx`
- Modify: `src/pages/admin/AdminRequests.jsx`
- Modify: `src/domain/requestDetails.js`
- Modify: `src/styles.css`
- Test: `tests/ui.permissions.test.jsx`

**Interfaces:**
- Consumes: `request.details`, `request.images`, `request.type`
- Produces: visible typed details, image grids, general and trade risk notices

- [ ] **Step 1: Write failing display tests**

Add tests:

```jsx
it('renders typed request details and anti-fraud notices before contact actions', async () => {
  fetch.mockResolvedValueOnce(jsonResponse({
    request: {
      id: 81,
      type: 'trade',
      title: '自家红薯礼盒',
      description: '物品：自家红薯礼盒；价格：68元/箱',
      city: '杭州',
      remote: false,
      industry: null,
      budgetOrReward: null,
      expiresAt: '2030-01-01T00:00:00.000Z',
      details: {
        itemName: '自家红薯礼盒',
        price: '68元/箱',
        condition: '5斤装',
        deliveryMethod: '快递',
      },
      images: [{ id: 1, url: '/uploads/request-images/a.png', mimeType: 'image/png', sizeBytes: 12, sortOrder: 0 }],
      owner: { nickname: '七秀同门', verificationStatus: 'approved' },
    },
  }));

  render(<RequestDetailPage requestId={81} session={{ verificationStatus: 'approved' }} onBack={() => {}} />);

  expect(await screen.findByRole('heading', { name: '自家红薯礼盒' })).toBeVisible();
  expect(screen.getByText('物品/服务名称：自家红薯礼盒')).toBeVisible();
  expect(screen.getByText('价格或交换方式：68元/箱')).toBeVisible();
  expect(screen.getByAltText('自家红薯礼盒 图片 1')).toBeVisible();
  expect(screen.getByText('请谨慎甄别委托信息，勿提前转账，谨防上当受骗。平台不提供交易担保。')).toBeVisible();
  expect(screen.getByText('涉及定金、代付、私下链接、异常低价时请提高警惕。万事屋不提供交易担保或售后仲裁。')).toBeVisible();
});

it('renders admin trade thumbnails and typed detail summary', async () => {
  fetch.mockResolvedValueOnce(jsonResponse({
    requests: [{
      id: 82,
      type: 'trade',
      title: '自家红薯礼盒',
      description: '物品：自家红薯礼盒；价格：68元/箱',
      city: '杭州',
      remote: false,
      expiresAt: '2030-01-01T00:00:00.000Z',
      status: 'pending',
      details: { itemName: '自家红薯礼盒', price: '68元/箱', condition: '5斤装', deliveryMethod: '快递' },
      images: [{ id: 1, url: '/uploads/request-images/a.png', mimeType: 'image/png', sizeBytes: 12, sortOrder: 0 }],
      owner: { nickname: '七秀同门', verificationStatus: 'approved' },
    }],
  }));

  render(<AdminRequests />);

  expect(await screen.findByText('物品/服务名称：自家红薯礼盒')).toBeVisible();
  expect(screen.getByAltText('委托 82 图片 1')).toBeVisible();
});
```

- [ ] **Step 2: Run failing display tests**

Run:

```bash
npm test -- tests/ui.permissions.test.jsx
```

Expected: FAIL because display components do not render typed details/images/notices yet.

- [ ] **Step 3: Add detail display helpers**

In `src/domain/requestDetails.js`, export:

```js
export function visibleDetailRows(type, details = {}) {
  return (requestDetailSchemas[type] ?? [])
    .map((field) => ({ label: field.label, value: details[field.name] }))
    .filter((row) => row.value);
}
```

- [ ] **Step 4: Update `FeedPage`**

In each card:

```jsx
{request.description && <p>{request.description}</p>}
{request.industry && ['job_referral', 'industry_consulting'].includes(request.type) && (
  <p>行业：{request.industry}</p>
)}
{request.images?.[0] && (
  <img className="request-card-cover" src={request.images[0].url} alt={`${request.title} 封面图`} />
)}
```

- [ ] **Step 5: Update `RequestDetailPage`**

Import:

```js
import { visibleDetailRows } from '../domain/requestDetails.js';
```

Render after description:

```jsx
<dl className="detail-grid typed-detail-grid">
  {visibleDetailRows(state.request.type, state.request.details).map((row) => (
    <div className="detail-item" key={row.label}>
      <dt>{row.label}</dt>
      <dd>{row.value}</dd>
    </div>
  ))}
</dl>
{state.request.type === 'trade' && state.request.images?.length > 0 && (
  <div className="request-image-grid" aria-label="买卖交易图片">
    {state.request.images.map((image, index) => (
      <img key={image.id ?? image.url} src={image.url} alt={`${state.request.title} 图片 ${index + 1}`} />
    ))}
  </div>
)}
```

Render after owner card and before contact card:

```jsx
<section className="risk-notice" aria-label="安全提醒">
  <p>请谨慎甄别委托信息，勿提前转账，谨防上当受骗。平台不提供交易担保。</p>
  {state.request.type === 'trade' && (
    <p>涉及定金、代付、私下链接、异常低价时请提高警惕。万事屋不提供交易担保或售后仲裁。</p>
  )}
</section>
```

- [ ] **Step 6: Update `AdminRequests`**

Import:

```js
import { visibleDetailRows } from '../../domain/requestDetails.js';
```

In the request cell:

```jsx
<td>
  {item.title}<br />
  类型：{typeLabel}<br />
  {item.description}
  <dl className="admin-detail-list">
    {visibleDetailRows(item.type, item.details).map((row) => (
      <React.Fragment key={row.label}>
        <dt>{row.label}</dt>
        <dd>{row.value}</dd>
      </React.Fragment>
    ))}
  </dl>
  {item.images?.length > 0 && (
    <div className="admin-request-image-grid">
      {item.images.map((image, index) => (
        <img key={image.id ?? image.url} src={image.url} alt={`委托 ${item.id} 图片 ${index + 1}`} />
      ))}
    </div>
  )}
</td>
```

- [ ] **Step 7: Add styles**

Add:

```css
.risk-notice {
  border: 1px solid rgba(180, 35, 24, 0.25);
  background: rgba(180, 35, 24, 0.08);
  color: var(--danger);
  border-radius: 8px;
  padding: 12px;
}

.request-image-grid,
.admin-request-image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
}

.admin-detail-list {
  display: grid;
  gap: 4px;
  margin: 8px 0 0;
}
```

- [ ] **Step 8: Run focused UI tests**

Run:

```bash
npm test -- tests/ui.permissions.test.jsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/pages/FeedPage.jsx src/pages/RequestDetailPage.jsx src/pages/admin/AdminRequests.jsx src/domain/requestDetails.js src/styles.css tests/ui.permissions.test.jsx
git commit -m "feat: show typed request details and risk notices"
```

---

### Task 5: E2E Coverage, Seed Data, And Full Verification

**Files:**
- Modify: `server/db.js`
- Modify: `tests/e2e.spec.js`
- Modify: `tests/api.requests.test.js`
- Modify: `tests/ui.permissions.test.jsx`

**Interfaces:**
- Consumes: all prior tasks
- Produces: verified user journeys and updated seeded demo data

- [ ] **Step 1: Update seed request to include details**

In `server/db.js`, update seeded request insert to include `details`:

```js
INSERT INTO requests (
  ownerId,
  type,
  title,
  description,
  details,
  city,
  remote,
  industry,
  budgetOrReward,
  expiresAt,
  status
)
```

Use:

```js
JSON.stringify({
  topic: '游戏行业产品岗位',
  questions: '想了解岗位分工、作品准备与面试节奏',
  preferredFormat: '微信文字或语音',
  background: '准备转向游戏行业',
})
```

- [ ] **Step 2: Add e2e trade image journey**

In `tests/e2e.spec.js`, add a create-page smoke test that logs in as an approved user, opens create page, selects trade, fills typed fields, and confirms the image upload control appears. API and UI tests cover persistence, admin approval, detail images, and risk notices.

```js
test('creates a trade request draft payload with image preview controls', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('账号').fill('qixiu');
  await page.getByLabel('密码').fill('test123');
  await page.getByRole('button', { name: '登录' }).click();
  await page.getByRole('button', { name: '发个委托' }).click();
  await page.getByLabel('类型').selectOption('trade');
  await page.getByLabel('标题').fill('自家红薯礼盒');
  await page.getByLabel('物品/服务名称').fill('自家红薯礼盒');
  await page.getByLabel('价格或交换方式').fill('68元/箱');
  await page.getByLabel('成色/规格').fill('5斤装');
  await page.getByLabel('交易/发货方式').fill('快递');
  await expect(page.getByLabel('买卖交易图片')).toBeVisible();
});
```

- [ ] **Step 3: Confirm no retired strings remain**

Run:

```bash
rg "fandom_help|追星互助|委托说明" src server tests docs -n
```

Expected: only historical design docs may mention retired strings. No runtime code or tests should require them.

- [ ] **Step 4: Run full automated tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Run e2e**

Run:

```bash
npm run e2e
```

Expected: PASS. If port 8787 is already in use, stop the known project dev server only with user approval, then rerun.

- [ ] **Step 7: Manual browser smoke check**

Start local app:

```bash
npm run dev:all
```

Check in browser:

- Create page has 6 types and no “追星互助”.
- Switching each type changes fields without layout overlap on mobile width.
- Trade image preview grid is stable and removable.
- Detail page shows typed rows and risk notices above contact application.
- Admin request review table shows typed details and trade thumbnails.

- [ ] **Step 8: Commit**

```bash
git add server/db.js tests/e2e.spec.js tests/api.requests.test.js tests/ui.permissions.test.jsx
git commit -m "test: cover typed request workflows"
```

---

## Self-Review Checklist

- Spec coverage: all spec items are covered by Tasks 1-5.
- Retired type: `fandom_help` is removed from constants, schema, UI options, filters, and write validation.
- Data contract: `details` is structured JSON text in SQLite and object DTOs in API responses.
- Description: generated by server, not trusted from client free text.
- Images: only trade, max 6, max 5MB, JPG/PNG/WebP, preview/detail/admin display covered.
- Risk notices: general and trade-specific reminders are positioned before contact actions.
- Testing: domain, DB, API, UI, build, and e2e verification are included.
