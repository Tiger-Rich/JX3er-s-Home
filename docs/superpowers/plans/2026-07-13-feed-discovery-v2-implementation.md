# Feed Discovery V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade 万事广场 from a simple list into a discoverable two-column card feed with channels, latest/recommended sorting, and heart reactions.

**Architecture:** Keep the current React/Vite + Express + SQLite prototype. Add a small reaction table and explainable server-side feed ranking, return only user-facing interaction state to the client, and render typed request cards from existing `details` data.

**Tech Stack:** React 19, Vite 8, lucide-react, Express 5, better-sqlite3, Vitest, Testing Library, Playwright.

## Global Constraints

- Product priority: first make target commissions easier to find, then improve browsing pleasure.
- The feed may borrow a light Xiaohongshu-style card stream, but cards must serve resource matching rather than content seeding.
- Heart reactions use only a heart icon plus number; visible UI text must not contain `点赞`.
- Existing contact safety remains unchanged: no public contact details, contact applications still require approved verification.
- Heart reactions require an active logged-in user, but do not require approved verification.
- Owner self-hearts may exist for display state, but must not add ranking weight.
- Approved, active, unexpired requests are the only public feed items.
- Recommendation score is server-only and must not be returned as `recommendationScore`.
- Request card summaries show at most three typed facts.
- Trade cards show the first uploaded image as a cover when present.
- “我的委托 / 我发布的委托管理” remains outside this build; remind the user after this V2 is accepted.

---

## File Structure

- `server/schema.sql`: add the durable `request_reactions` table.
- `server/db.js`: make existing local databases self-migrate by creating `request_reactions` when missing.
- `server/auth.js`: add optional authenticated-user middleware for public feed reads.
- `server/feedDiscovery.js`: new focused module for feed channels, sort normalization, and explainable ranking.
- `server/routes/requests.js`: expose reaction counts/state, reaction create/delete endpoints, channel filters, and ranking.
- `src/domain/feedDiscovery.js`: new frontend constants and card fact builders for channels and typed summaries.
- `src/components/ReactionButton.jsx`: new heart icon/count button with accessible labels that avoid `点赞`.
- `src/pages/FeedPage.jsx`: render channel tabs, compact filters, sort switch, two-column cards, and optimistic heart mutations.
- `src/styles.css`: add feed grid, channel bar, typed facts, trade cover, and reaction button styles.
- `tests/api.requests.test.js`: cover backend reaction, channel, and ranking behavior.
- `tests/ui.permissions.test.jsx`: cover feed UI rendering, channel requests, and heart mutation rollback.
- `tests/e2e.spec.js`: cover a logged-in user browsing the new feed and toggling a heart.

---

### Task 1: Backend Heart Reactions and Public DTO State

**Files:**
- Modify: `server/schema.sql`
- Modify: `server/db.js`
- Modify: `server/auth.js`
- Modify: `server/routes/requests.js`
- Test: `tests/api.requests.test.js`

**Interfaces:**
- Produces: `optionalUser(db)` middleware in `server/auth.js`, setting `req.user` to an active user or `null`.
- Produces: public request DTO fields `reactionCount: number` and `reactedByMe: boolean`.
- Produces: `POST /api/requests/:id/reaction` and `DELETE /api/requests/:id/reaction`, both returning `{ reactionCount, reactedByMe }`.

- [ ] **Step 1: Add failing API tests for reaction permissions and DTO fields**

Add these tests near the existing favorite tests in `tests/api.requests.test.js`:

```js
  it('exposes reaction counts and viewer reaction state on public list and detail', async () => {
    const requestId = insertRequest({ title: 'Reaction target' });
    const pendingId = insertUser({
      account: 'pending-reaction',
      verificationStatus: 'pending',
    });

    db.prepare(
      'INSERT INTO request_reactions (userId, requestId) VALUES (?, ?)',
    ).run(pendingId, requestId);

    const anonymousList = await request(app).get('/api/requests');
    const viewerList = await request(app)
      .get('/api/requests')
      .set(auth(pendingId));
    const viewerDetail = await request(app)
      .get(`/api/requests/${requestId}`)
      .set(auth(pendingId));

    expect(anonymousList.status).toBe(200);
    expect(anonymousList.body.requests).toContainEqual(
      expect.objectContaining({
        id: requestId,
        reactionCount: 1,
        reactedByMe: false,
      }),
    );
    expect(viewerList.body.requests).toContainEqual(
      expect.objectContaining({
        id: requestId,
        reactionCount: 1,
        reactedByMe: true,
      }),
    );
    expect(viewerDetail.body.request).toMatchObject({
      id: requestId,
      reactionCount: 1,
      reactedByMe: true,
    });
    expect(JSON.stringify(viewerList.body)).not.toContain('recommendationScore');
  });

  it('lets active unverified users toggle a heart reaction without duplicating rows', async () => {
    const requestId = insertRequest();
    const pendingId = insertUser({
      account: 'unverified-heart',
      verificationStatus: 'pending',
    });

    const anonymous = await request(app).post(`/api/requests/${requestId}/reaction`);
    const first = await request(app)
      .post(`/api/requests/${requestId}/reaction`)
      .set(auth(pendingId));
    const second = await request(app)
      .post(`/api/requests/${requestId}/reaction`)
      .set(auth(pendingId));
    const removed = await request(app)
      .delete(`/api/requests/${requestId}/reaction`)
      .set(auth(pendingId));

    expect(anonymous.status).toBe(401);
    expect(first.body).toEqual({ reactionCount: 1, reactedByMe: true });
    expect(second.body).toEqual({ reactionCount: 1, reactedByMe: true });
    expect(removed.body).toEqual({ reactionCount: 0, reactedByMe: false });
    expect(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM request_reactions WHERE userId = ? AND requestId = ?',
        )
        .get(pendingId, requestId).count,
    ).toBe(0);
  });

  it.each([
    ['pending request', { status: 'pending', expiresAt: FUTURE }],
    ['taken down request', { status: 'taken_down', expiresAt: FUTURE }],
    ['expired request', { status: 'approved', expiresAt: PAST }],
  ])('does not add a reaction to a hidden %s', async (_label, hidden) => {
    const requestId = insertRequest(hidden);

    const response = await request(app)
      .post(`/api/requests/${requestId}/reaction`)
      .set(auth(users.wanhua));

    expect(response.status).toBe(404);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM request_reactions WHERE requestId = ?')
        .get(requestId).count,
    ).toBe(0);
  });
```

- [ ] **Step 2: Run the targeted API tests and verify they fail**

Run:

```bash
npm test -- tests/api.requests.test.js
```

Expected: FAIL because `request_reactions` and `/reaction` endpoints do not exist yet.

- [ ] **Step 3: Add the reaction table to schema and migration**

Append to `server/schema.sql` after `favorites`:

```sql
CREATE TABLE IF NOT EXISTS request_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  requestId INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (userId, requestId),
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (requestId) REFERENCES requests(id) ON DELETE CASCADE
);
```

Add to `migrateDatabase(db)` in `server/db.js` after the existing `details` migration:

```js
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      requestId INTEGER NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (userId, requestId),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (requestId) REFERENCES requests(id) ON DELETE CASCADE
    )
  `);
```

- [ ] **Step 4: Add optional public-feed authentication**

Add this export to `server/auth.js` below `requireUser(db)`:

```js
export function optionalUser(db) {
  return (req, _res, next) => {
    const userId = parseToken(req.get('authorization'));
    const user = loadCurrentUser(db, userId);
    req.user = user?.status === 'active' ? user : null;
    return next();
  };
}
```

- [ ] **Step 5: Return reaction state in request DTOs**

In `server/routes/requests.js`, change the import to:

```js
import { optionalUser, requireUser } from '../auth.js';
```

Extend `REQUEST_COLUMNS` with aggregate fields:

```js
  COALESCE(rr.reactionCount, 0) AS reactionCount,
  CASE WHEN ? IS NULL THEN 0 ELSE EXISTS (
    SELECT 1 FROM request_reactions mine
    WHERE mine.requestId = r.id AND mine.userId = ?
  ) END AS reactedByMe
```

Add the aggregate join to public list and detail queries:

```sql
LEFT JOIN (
  SELECT requestId, COUNT(*) AS reactionCount
  FROM request_reactions
  GROUP BY requestId
) rr ON rr.requestId = r.id
```

Update the DTO builder:

```js
    reactionCount: Number(row.reactionCount ?? 0),
    reactedByMe: Boolean(row.reactedByMe),
```

Change list/detail routes to use `optionalUser(db)` and pass `req.user?.id ?? null` as the first two bound SQL parameters before existing filters.

- [ ] **Step 6: Add reaction endpoints**

Add this helper near `publicRequestById` in `server/routes/requests.js`:

```js
function reactionState(db, requestId, userId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS reactionCount,
              EXISTS (
                SELECT 1 FROM request_reactions
                WHERE requestId = ? AND userId = ?
              ) AS reactedByMe
       FROM request_reactions
       WHERE requestId = ?`,
    )
    .get(requestId, userId, requestId);
  return {
    reactionCount: Number(row.reactionCount ?? 0),
    reactedByMe: Boolean(row.reactedByMe),
  };
}
```

Add routes before `/:id/favorite`:

```js
  router.post('/:id/reaction', requireUser(db), (req, res, next) => {
    try {
      const requestId = positiveId(req.params.id);
      if (!publicRequestById(db, requestId, req.user.id)) {
        return res.status(404).json({ error: 'Request not found' });
      }
      db.prepare(
        'INSERT OR IGNORE INTO request_reactions (userId, requestId) VALUES (?, ?)',
      ).run(req.user.id, requestId);
      return res.json(reactionState(db, requestId, req.user.id));
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id/reaction', requireUser(db), (req, res, next) => {
    try {
      const requestId = positiveId(req.params.id);
      if (!publicRequestById(db, requestId, req.user.id)) {
        return res.status(404).json({ error: 'Request not found' });
      }
      db.prepare(
        'DELETE FROM request_reactions WHERE userId = ? AND requestId = ?',
      ).run(req.user.id, requestId);
      return res.json(reactionState(db, requestId, req.user.id));
    } catch (error) {
      return next(error);
    }
  });
```

- [ ] **Step 7: Run targeted API tests**

Run:

```bash
npm test -- tests/api.requests.test.js
```

Expected: PASS for all request API tests.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add server/schema.sql server/db.js server/auth.js server/routes/requests.js tests/api.requests.test.js
git commit -m "feat: add request heart reactions"
```

---

### Task 2: Backend Feed Channels and Explainable Ranking

**Files:**
- Create: `server/feedDiscovery.js`
- Modify: `server/routes/requests.js`
- Test: `tests/api.requests.test.js`

**Interfaces:**
- Produces: `normalizeFeedQuery(query)` returning `{ channel, sort, typeFromChannel }`.
- Produces: `sortFeedRows(rows, context)` returning sorted row objects without exposing scores.
- Consumes: `reactionCount`, `favoriteCount`, and `applicationCount` aggregate columns.

- [ ] **Step 1: Add failing API tests for channels and ranking**

Add these tests near the existing public list ordering test:

```js
  it('filters feed channels and supports latest ordering', async () => {
    db.prepare('DELETE FROM requests').run();
    const tradeId = insertRequest({ type: 'trade', title: 'Trade channel' });
    const referralId = insertRequest({
      type: 'job_referral',
      title: 'Referral channel',
    });
    db.prepare(
      `UPDATE requests SET createdAt = '2098-01-01 00:00:00' WHERE id = ?`,
    ).run(tradeId);
    db.prepare(
      `UPDATE requests SET createdAt = '2098-01-02 00:00:00' WHERE id = ?`,
    ).run(referralId);

    const trade = await request(app).get('/api/requests?channel=trade');
    const latest = await request(app).get('/api/requests?channel=latest&sort=latest');
    const invalid = await request(app).get('/api/requests?channel=boosting');

    expect(trade.status).toBe(200);
    expect(trade.body.requests.map(({ id }) => id)).toEqual([tradeId]);
    expect(latest.body.requests.map(({ id }) => id)).toEqual([
      referralId,
      tradeId,
    ]);
    expect(invalid.status).toBe(400);
  });

  it('uses reactions, favorites, applications, and self-heart exclusion in recommended ordering', async () => {
    db.prepare('DELETE FROM contact_applications').run();
    db.prepare('DELETE FROM favorites').run();
    db.prepare('DELETE FROM request_reactions').run();
    db.prepare('DELETE FROM requests').run();

    const quietId = insertRequest({
      title: 'Fresh quiet',
      type: 'other',
    });
    const engagedId = insertRequest({
      title: 'Engaged referral',
      type: 'job_referral',
    });
    const selfHeartId = insertRequest({
      title: 'Self heart only',
      type: 'other',
    });
    const applicantId = insertUser({ account: 'ranking-applicant' });

    db.prepare(
      `UPDATE requests SET createdAt = '2098-01-03 00:00:00' WHERE id = ?`,
    ).run(quietId);
    db.prepare(
      `UPDATE requests SET createdAt = '2098-01-02 00:00:00' WHERE id = ?`,
    ).run(engagedId);
    db.prepare(
      `UPDATE requests SET createdAt = '2098-01-01 00:00:00' WHERE id = ?`,
    ).run(selfHeartId);
    db.prepare(
      'INSERT INTO request_reactions (userId, requestId) VALUES (?, ?)',
    ).run(users.wanhua, engagedId);
    db.prepare(
      'INSERT INTO request_reactions (userId, requestId) VALUES (?, ?)',
    ).run(users.qixiu, selfHeartId);
    db.prepare('INSERT INTO favorites (userId, requestId) VALUES (?, ?)').run(
      users.wanhua,
      engagedId,
    );
    db.prepare(
      `INSERT INTO contact_applications
         (requestId, applicantId, ownerId, message, status)
       VALUES (?, ?, ?, 'Interested', 'pending')`,
    ).run(engagedId, applicantId, users.qixiu);

    const response = await request(app).get(
      '/api/requests?channel=recommended&sort=recommended',
    );

    expect(response.status).toBe(200);
    expect(response.body.requests.map(({ id }) => id)[0]).toBe(engagedId);
    expect(response.body.requests.map(({ id }) => id)).toEqual(
      expect.arrayContaining([quietId, selfHeartId]),
    );
    expect(JSON.stringify(response.body)).not.toContain('recommendationScore');
  });

  it('returns a nearby metadata hint when the viewer city is unavailable', async () => {
    const anonymous = await request(app).get('/api/requests?channel=nearby');
    const viewer = await request(app)
      .get('/api/requests?channel=nearby')
      .set(auth(users.qixiu));

    expect(anonymous.status).toBe(200);
    expect(anonymous.body.meta).toMatchObject({ nearbyCityRequired: true });
    expect(anonymous.body.requests).toEqual([]);
    expect(viewer.status).toBe(200);
    expect(viewer.body.meta).toMatchObject({
      nearbyCityRequired: false,
      nearbyCity: expect.any(String),
    });
  });
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:

```bash
npm test -- tests/api.requests.test.js
```

Expected: FAIL because `channel`, `sort`, ranking aggregates, and nearby metadata are not implemented.

- [ ] **Step 3: Create feed query and ranking helpers**

Create `server/feedDiscovery.js`:

```js
const CHANNEL_TO_TYPE = {
  job_referral: 'job_referral',
  industry_consulting: 'industry_consulting',
  trade: 'trade',
};

const CHANNELS = new Set([
  'recommended',
  'latest',
  'nearby',
  'job_referral',
  'industry_consulting',
  'trade',
]);

const SORTS = new Set(['recommended', 'latest']);

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.exposeToClient = true;
  return error;
}

function queryText(value, field) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || !value.trim()) {
    throw clientError(400, `Invalid ${field} filter`);
  }
  return value.trim();
}

export function normalizeFeedQuery(query) {
  const channel = queryText(query.channel, 'channel') || 'recommended';
  const sort = queryText(query.sort, 'sort') || (channel === 'latest' ? 'latest' : 'recommended');
  if (!CHANNELS.has(channel)) throw clientError(400, 'Invalid channel');
  if (!SORTS.has(sort)) throw clientError(400, 'Invalid sort');
  return {
    channel,
    sort,
    typeFromChannel: CHANNEL_TO_TYPE[channel] ?? '',
  };
}

function freshnessScore(createdAt) {
  const ageHours = Math.max(
    0,
    (Date.now() - new Date(createdAt).getTime()) / 36e5,
  );
  return Math.max(0, 24 - Math.min(ageHours, 168) / 7);
}

function typeWeight(type) {
  if (type === 'job_referral') return 7;
  if (type === 'industry_consulting') return 6;
  if (type === 'local_help') return 3;
  return 1;
}

function profileCompletenessScore(row) {
  const fields = [
    row.ownerServer,
    row.ownerGameNickname,
    row.ownerSect,
    row.ownerStartedYear,
    row.ownerIndustry,
    row.ownerOccupation,
  ];
  return fields.filter(Boolean).length;
}

function riskPenalty(row) {
  const hoursToExpiry =
    (new Date(row.expiresAt).getTime() - Date.now()) / 36e5;
  return hoursToExpiry < 24 ? 8 : 0;
}

function selfExcludedReactionCount(row) {
  return Math.max(
    0,
    Number(row.reactionCount ?? 0) - Number(row.ownerReactionCount ?? 0),
  );
}

export function scoreRequest(row, context = {}) {
  const matchScore =
    (context.channel === 'nearby' && row.city === context.viewer?.city ? 8 : 0) +
    (context.typeFromChannel && row.type === context.typeFromChannel ? 6 : 0);
  return (
    freshnessScore(row.createdAt) +
    typeWeight(row.type) +
    matchScore +
    Math.log1p(selfExcludedReactionCount(row)) * 2 +
    Math.log1p(Number(row.favoriteCount ?? 0)) * 4 +
    Math.log1p(Number(row.applicationCount ?? 0)) * 5 +
    profileCompletenessScore(row) -
    riskPenalty(row)
  );
}

function newestFirst(left, right) {
  const createdDifference =
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  return createdDifference || right.id - left.id;
}

export function sortFeedRows(rows, context) {
  if (context.sort === 'latest') return [...rows].sort(newestFirst);
  return [...rows].sort((left, right) => {
    const scoreDifference =
      scoreRequest(right, context) - scoreRequest(left, context);
    return scoreDifference || newestFirst(left, right);
  });
}
```

- [ ] **Step 4: Wire channels and ranking into `GET /api/requests`**

Import helpers in `server/routes/requests.js`:

```js
import { normalizeFeedQuery, sortFeedRows } from '../feedDiscovery.js';
```

Add aggregate columns to `REQUEST_COLUMNS`:

```js
  COALESCE(fr.favoriteCount, 0) AS favoriteCount,
  COALESCE(ca.applicationCount, 0) AS applicationCount,
  COALESCE(orx.ownerReactionCount, 0) AS ownerReactionCount
```

Add joins to the public list query:

```sql
LEFT JOIN (
  SELECT requestId, COUNT(*) AS favoriteCount
  FROM favorites
  GROUP BY requestId
) fr ON fr.requestId = r.id
LEFT JOIN (
  SELECT requestId, COUNT(*) AS applicationCount
  FROM contact_applications
  GROUP BY requestId
) ca ON ca.requestId = r.id
LEFT JOIN (
  SELECT rr.requestId, COUNT(*) AS ownerReactionCount
  FROM request_reactions rr
  JOIN requests owned ON owned.id = rr.requestId
  WHERE rr.userId = owned.ownerId
  GROUP BY rr.requestId
) orx ON orx.requestId = r.id
```

At the start of the list route, normalize feed query:

```js
      const feedQuery = normalizeFeedQuery(req.query);
      const meta = {};
      if (feedQuery.typeFromChannel) {
        clauses.push('r.type = ?');
        values.push(feedQuery.typeFromChannel);
      }
      if (feedQuery.channel === 'nearby') {
        if (!req.user?.city) {
          return res.json({
            requests: [],
            meta: { nearbyCityRequired: true },
          });
        }
        clauses.push('r.city = ?');
        values.push(req.user.city);
        meta.nearbyCityRequired = false;
        meta.nearbyCity = req.user.city;
      }
```

Keep existing explicit `type`, `city`, `industry`, and `remote` filters. Replace SQL `ORDER BY ...` with stable fallback SQL:

```sql
ORDER BY datetime(r.createdAt) DESC, r.id DESC
```

Sort rows before DTO mapping:

```js
      const sortedRows = sortFeedRows(rows, {
        channel: feedQuery.channel,
        sort: feedQuery.sort,
        typeFromChannel: feedQuery.typeFromChannel,
        viewer: req.user,
      });
      return res.json({
        requests: sortedRows.map((row) =>
          requestDto({ ...row, images: imagesByRequestId.get(row.id) ?? [] }),
        ),
        meta,
      });
```

- [ ] **Step 5: Keep detail route compatible**

For detail SQL, keep `favoriteCount`, `applicationCount`, and `ownerReactionCount` either joined as zero-valued aggregates or omitted from DTO-visible output. Ensure `requestDto()` never returns those internal aggregate names.

- [ ] **Step 6: Update old ordering test expectations**

Replace the old `prioritizes referral and consulting requests before newest other types` test body with a recommended-order assertion that accepts the new ranking rule:

```js
  it('keeps referral and consulting visible in recommended sorting without hiding newest sorting', async () => {
    db.prepare('DELETE FROM requests').run();
    const otherId = insertRequest({ type: 'other', title: 'Newest other' });
    const consultingId = insertRequest({
      type: 'industry_consulting',
      title: 'Consulting priority',
    });
    const referralId = insertRequest({
      type: 'job_referral',
      title: 'Referral priority',
    });
    db.prepare(
      `UPDATE requests SET createdAt = '2098-01-03 00:00:00' WHERE id = ?`,
    ).run(otherId);
    db.prepare(
      `UPDATE requests SET createdAt = '2098-01-02 00:00:00' WHERE id = ?`,
    ).run(consultingId);
    db.prepare(
      `UPDATE requests SET createdAt = '2098-01-01 00:00:00' WHERE id = ?`,
    ).run(referralId);

    const recommended = await request(app).get('/api/requests');
    const latest = await request(app).get('/api/requests?sort=latest');

    expect(recommended.status).toBe(200);
    expect(recommended.body.requests.map(({ id }) => id).slice(0, 2)).toEqual([
      consultingId,
      referralId,
    ]);
    expect(latest.body.requests.map(({ id }) => id)).toEqual([
      otherId,
      consultingId,
      referralId,
    ]);
  });
```

- [ ] **Step 7: Run targeted API tests**

Run:

```bash
npm test -- tests/api.requests.test.js
```

Expected: PASS for all request API tests.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git add server/feedDiscovery.js server/routes/requests.js tests/api.requests.test.js
git commit -m "feat: add feed channels and ranking"
```

---

### Task 3: Frontend Feed Cards, Channels, and Heart Interaction

**Files:**
- Create: `src/domain/feedDiscovery.js`
- Create: `src/components/ReactionButton.jsx`
- Modify: `src/pages/FeedPage.jsx`
- Test: `tests/ui.permissions.test.jsx`

**Interfaces:**
- Consumes: `GET /api/requests?channel=<channel>&sort=<sort>&city=<city>&industry=<industry>&remote=<remote>`.
- Consumes: request fields `reactionCount`, `reactedByMe`, `details`, and `images`.
- Produces: typed card facts with `buildRequestCardFacts(request)`.

- [ ] **Step 1: Add failing UI tests for feed channels and heart mutation**

Add these tests inside `describe('user workflow pages', ...)` in `tests/ui.permissions.test.jsx`:

```jsx
  it('renders feed channels, typed card facts, and heart counts without forbidden copy', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      requests: [{
        id: 501,
        ownerId: 10,
        type: 'job_referral',
        title: '前端岗位内推',
        details: {
          targetRole: '前端工程师',
          targetIndustry: '互联网',
          helpWanted: '希望获得内推和简历建议',
        },
        city: '杭州',
        remote: true,
        industry: '互联网',
        expiresAt: '2030-01-01T00:00:00.000Z',
        reactionCount: 7,
        reactedByMe: false,
        owner: {
          nickname: '七秀同门',
          server: '梦江南',
          sect: '七秀',
          city: '杭州',
          verificationStatus: 'approved',
        },
      }],
      meta: {},
    }));

    render(<FeedPage onSelectRequest={() => {}} />);

    expect(await screen.findByRole('heading', { name: '万事广场' })).toBeVisible();
    for (const channel of ['推荐', '最新', '同城', '求职内推', '行业咨询', '买卖交易']) {
      expect(screen.getByRole('button', { name: channel })).toBeVisible();
    }
    expect(screen.getByText('目标岗位：前端工程师')).toBeVisible();
    expect(screen.getByText('目标行业：互联网')).toBeVisible();
    expect(screen.getByText('杭州 / 可远程')).toBeVisible();
    expect(screen.getByRole('button', { name: '点亮心形：前端岗位内推，当前 7' })).toBeVisible();
    expect(screen.queryByText('点赞')).not.toBeInTheDocument();
  });

  it('requests channels and optimistically toggles heart state with rollback on failure', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({
        requests: [{
          id: 502,
          ownerId: 10,
          type: 'trade',
          title: '自家红薯礼盒',
          details: {
            price: '68 元一箱',
            deliveryMethod: '快递',
          },
          images: [{ id: 1, url: '/uploads/request-images/a.png', sortOrder: 0 }],
          city: '成都',
          remote: false,
          expiresAt: '2030-01-01T00:00:00.000Z',
          reactionCount: 1,
          reactedByMe: false,
          owner: { nickname: '万花同门', verificationStatus: 'approved' },
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        requests: [],
        meta: {},
      }))
      .mockRejectedValueOnce(new Error('network down'));
    const user = userEvent.setup();

    render(<FeedPage onSelectRequest={() => {}} />);

    await user.click(await screen.findByRole('button', { name: '买卖交易' }));
    await waitFor(() => expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/requests?channel=trade&sort=recommended',
      expect.any(Object),
    ));

    await screen.findByText('暂时没有符合条件的委托。');

    fetch.mockResolvedValueOnce(jsonResponse({
      requests: [{
        id: 502,
        ownerId: 10,
        type: 'trade',
        title: '自家红薯礼盒',
        details: {
          price: '68 元一箱',
          deliveryMethod: '快递',
        },
        images: [{ id: 1, url: '/uploads/request-images/a.png', sortOrder: 0 }],
        city: '成都',
        remote: false,
        expiresAt: '2030-01-01T00:00:00.000Z',
        reactionCount: 1,
        reactedByMe: false,
        owner: { nickname: '万花同门', verificationStatus: 'approved' },
      }],
    }));
    await user.click(screen.getByRole('button', { name: '推荐' }));
    const heart = await screen.findByRole('button', {
      name: '点亮心形：自家红薯礼盒，当前 1',
    });
    await user.click(heart);

    expect(await screen.findByRole('button', {
      name: '点亮心形：自家红薯礼盒，当前 1',
    })).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent('network down');
  });
```

- [ ] **Step 2: Run targeted UI tests and verify they fail**

Run:

```bash
npm test -- tests/ui.permissions.test.jsx
```

Expected: FAIL because feed channels, typed cards, and reaction buttons are not present.

- [ ] **Step 3: Create frontend feed domain helpers**

Create `src/domain/feedDiscovery.js`:

```js
export const feedChannels = [
  { value: 'recommended', label: '推荐' },
  { value: 'latest', label: '最新' },
  { value: 'nearby', label: '同城' },
  { value: 'job_referral', label: '求职内推' },
  { value: 'industry_consulting', label: '行业咨询' },
  { value: 'trade', label: '买卖交易' },
];

export const feedSorts = [
  { value: 'recommended', label: '推荐' },
  { value: 'latest', label: '最新' },
];

function compactFacts(facts) {
  return facts.filter(({ value }) => Boolean(value)).slice(0, 3);
}

function locationLabel(request) {
  if (request.remote && request.city) return `${request.city} / 可远程`;
  if (request.remote) return '可远程';
  return request.city || '城市未标注';
}

export function buildRequestCardFacts(request) {
  const details = request.details ?? {};
  if (request.type === 'job_referral') {
    return compactFacts([
      { label: '目标岗位', value: details.targetRole },
      { label: '目标行业', value: details.targetIndustry || request.industry },
      { label: '地点方式', value: locationLabel(request) },
      { label: '希望帮助', value: details.helpWanted },
    ]);
  }
  if (request.type === 'industry_consulting') {
    return compactFacts([
      { label: '咨询方向', value: details.topic || request.industry },
      { label: '具体问题', value: details.questions },
      { label: '交流方式', value: details.preferredFormat },
    ]);
  }
  if (request.type === 'trade') {
    return compactFacts([
      { label: '价格/交换', value: details.price },
      { label: '交易方式', value: details.deliveryMethod },
      { label: '所在城市', value: request.city },
    ]);
  }
  if (request.type === 'commission') {
    return compactFacts([
      { label: '委托内容', value: details.commissionContent },
      { label: '预算', value: details.budget || request.budgetOrReward },
      { label: '交付时间', value: details.deadline },
    ]);
  }
  if (request.type === 'local_help') {
    return compactFacts([
      { label: '互助事项', value: details.helpTask },
      { label: '地点', value: details.area || request.city },
      { label: '时间窗口', value: details.timeWindow },
    ]);
  }
  return compactFacts([
    { label: '事情类型', value: details.requestKind },
    { label: '希望帮助', value: details.helpWanted },
    { label: '回报方式', value: details.reward || request.budgetOrReward },
  ]);
}
```

- [ ] **Step 4: Create heart reaction button**

Create `src/components/ReactionButton.jsx`:

```jsx
import React from 'react';
import { Heart } from 'lucide-react';

export default function ReactionButton({
  count,
  disabled = false,
  reacted,
  requestTitle,
  onToggle,
}) {
  const safeCount = Number(count ?? 0);
  const label = reacted
    ? `取消心形：${requestTitle}，当前 ${safeCount}`
    : `点亮心形：${requestTitle}，当前 ${safeCount}`;

  return (
    <button
      type="button"
      className={`reaction-button${reacted ? ' is-active' : ''}`}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
    >
      <Heart
        aria-hidden="true"
        size={18}
        fill={reacted ? 'currentColor' : 'none'}
      />
      <span>{safeCount}</span>
    </button>
  );
}
```

- [ ] **Step 5: Replace feed rendering with channels, sort, typed cards, and optimistic reactions**

In `src/pages/FeedPage.jsx`, remove local `priorityTypes`, `industrySummaryTypes`, and `sortedRequests`. Import:

```jsx
import { Eye } from 'lucide-react';
import ReactionButton from '../components/ReactionButton.jsx';
import {
  buildRequestCardFacts,
  feedChannels,
  feedSorts,
} from '../domain/feedDiscovery.js';
```

Add state:

```jsx
  const [channel, setChannel] = useState('recommended');
  const [sort, setSort] = useState('recommended');
  const [mutationError, setMutationError] = useState('');
  const [pendingReactionId, setPendingReactionId] = useState(null);
```

Build query with channel and sort:

```jsx
    params.set('channel', channel);
    params.set('sort', channel === 'latest' ? 'latest' : sort);
```

Add the reaction mutation:

```jsx
  async function toggleReaction(requestId) {
    const target = state.requests.find((request) => request.id === requestId);
    if (!target || pendingReactionId) return;
    const nextReacted = !target.reactedByMe;
    const nextCount = Math.max(
      0,
      Number(target.reactionCount ?? 0) + (nextReacted ? 1 : -1),
    );
    setMutationError('');
    setPendingReactionId(requestId);
    setState((current) => ({
      ...current,
      requests: current.requests.map((request) =>
        request.id === requestId
          ? { ...request, reactedByMe: nextReacted, reactionCount: nextCount }
          : request,
      ),
    }));
    try {
      const result = await api(`/api/requests/${requestId}/reaction`, {
        method: nextReacted ? 'POST' : 'DELETE',
      });
      setState((current) => ({
        ...current,
        requests: current.requests.map((request) =>
          request.id === requestId
            ? {
                ...request,
                reactedByMe: result.reactedByMe,
                reactionCount: result.reactionCount,
              }
            : request,
        ),
      }));
    } catch (error) {
      setMutationError(error.message || '心形状态未能更新');
      setState((current) => ({
        ...current,
        requests: current.requests.map((request) =>
          request.id === requestId ? target : request,
        ),
      }));
    } finally {
      setPendingReactionId(null);
    }
  }
```

Render channels and sort before filters:

```jsx
      <div className="feed-channel-bar" role="group" aria-label="万事广场频道">
        {feedChannels.map((item) => (
          <button
            key={item.value}
            type="button"
            className={item.value === channel ? 'button-primary' : 'button-secondary'}
            onClick={() => setChannel(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="feed-sort-bar" role="group" aria-label="委托排序">
        {feedSorts.map((item) => (
          <button
            key={item.value}
            type="button"
            className={item.value === sort ? 'button-primary' : 'button-secondary'}
            onClick={() => setSort(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
```

Render each card from typed facts:

```jsx
              {request.images?.[0] && (
                <img
                  className="request-card-cover"
                  src={request.images[0].url}
                  alt={`${request.title} 封面图`}
                />
              )}
              <p className="request-type-pill">{requestTypeLabel(request.type)}</p>
              <h3>{request.title}</h3>
              <dl className="request-card-facts">
                {buildRequestCardFacts(request).map((fact) => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="request-card-owner">
                {request.owner?.nickname || '未署名侠士'}
                {request.owner?.server ? ` · ${request.owner.server}` : ''}
                {request.owner?.verificationStatus === 'approved' ? ' · 已认证' : ''}
              </p>
              <div className="request-card-actions">
                <ReactionButton
                  count={request.reactionCount}
                  disabled={pendingReactionId === request.id}
                  reacted={request.reactedByMe}
                  requestTitle={request.title}
                  onToggle={() => toggleReaction(request.id)}
                />
                <button
                  type="button"
                  onClick={() => onSelectRequest?.(request.id)}
                  className="button-secondary"
                >
                  <Eye aria-hidden="true" size={18} />查看委托
                </button>
              </div>
```

Render mutation error:

```jsx
      {mutationError && <p role="alert">{mutationError}</p>}
```

- [ ] **Step 6: Run targeted UI tests**

Run:

```bash
npm test -- tests/ui.permissions.test.jsx
```

Expected: PASS for all UI tests.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add src/domain/feedDiscovery.js src/components/ReactionButton.jsx src/pages/FeedPage.jsx tests/ui.permissions.test.jsx
git commit -m "feat: redesign feed cards and reactions"
```

---

### Task 4: Feed Visual Polish and End-to-End Acceptance

**Files:**
- Modify: `src/styles.css`
- Modify: `tests/e2e.spec.js`
- Test: full test suite, production build, Playwright e2e.

**Interfaces:**
- Consumes: `.request-list`, `.request-card`, `.request-card-cover`, `.feed-channel-bar`, `.feed-sort-bar`, `.reaction-button`.
- Produces: a stable two-column card grid on mobile-sized and desktop-sized browser widths.

- [ ] **Step 1: Add failing e2e coverage for feed channels and heart toggle**

Add or extend an e2e test in `tests/e2e.spec.js`:

```js
test('user browses feed channels and toggles a heart reaction', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('账号').fill('wanhua');
  await page.getByLabel('密码').fill('test123');
  await page.getByRole('button', { name: '登录' }).click();

  await expect(page.getByRole('heading', { name: '万事广场' })).toBeVisible();
  await page.getByRole('button', { name: '最新' }).click();
  await expect(page.locator('.request-list')).toBeVisible();
  await page.getByRole('button', { name: '推荐' }).click();

  const heart = page.getByRole('button', { name: /点亮心形|取消心形/ }).first();
  await expect(heart).toBeVisible();
  const before = await heart.textContent();
  await heart.click();
  await expect(heart).not.toHaveText(before ?? '');
  await expect(page.getByText('点赞')).toHaveCount(0);
});
```

- [ ] **Step 2: Run e2e and verify it fails before styles/seed alignment**

Run:

```bash
npm run e2e
```

Expected: FAIL if the current UI text, selectors, or layout classes are not yet aligned.

- [ ] **Step 3: Add responsive feed styles**

Add to `src/styles.css` near existing feed styles:

```css
.feed-channel-bar,
.feed-sort-bar {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.feed-channel-bar button,
.feed-sort-bar button {
  flex: 0 0 auto;
}

.request-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.request-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.request-card-cover {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 6px;
}

.request-type-pill {
  width: fit-content;
  margin: 0;
  font-size: 12px;
  font-weight: 700;
}

.request-card h3 {
  display: -webkit-box;
  min-height: 44px;
  margin: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.request-card-facts {
  display: grid;
  gap: 6px;
  margin: 0;
}

.request-card-facts div {
  min-width: 0;
}

.request-card-facts dt {
  font-size: 12px;
  color: var(--muted-text);
}

.request-card-facts dd {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.request-card-owner {
  overflow: hidden;
  margin: auto 0 0;
  color: var(--muted-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.request-card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.reaction-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  height: 36px;
  gap: 4px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--surface-color);
  color: var(--text-color);
}

.reaction-button.is-active {
  border-color: #c2410c;
  color: #c2410c;
}

@media (min-width: 760px) {
  .request-list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
```

If the project uses different CSS custom property names, map these styles to existing tokens in `src/styles.css` instead of introducing unused variables.

- [ ] **Step 4: Verify no forbidden visible copy was introduced**

Run:

```bash
rg "点赞" src tests -n
```

Expected: only negative assertions in tests may appear; no source component should contain `点赞`.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm test
npm run build
npm run e2e
```

Expected:
- `npm test`: all tests pass.
- `npm run build`: Vite build succeeds.
- `npm run e2e`: all Playwright tests pass.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/styles.css tests/e2e.spec.js
git commit -m "test: cover feed discovery workflow"
```

---

## Final Acceptance Checklist

- [ ] 万事广场默认进入“推荐”频道。
- [ ] 用户可以切换“推荐 / 最新 / 同城 / 求职内推 / 行业咨询 / 买卖交易”。
- [ ] 用户可以切换“推荐 / 最新”排序。
- [ ] 卡片流不是单列旧列表，移动端可稳定双列展示。
- [ ] 每张卡片最多展示三个 typed facts，详情页仍保留完整信息。
- [ ] 交易卡片有图片时显示封面图。
- [ ] 心形按钮显示空心/实心状态和数字，不出现 `点赞` 可见文案。
- [ ] 未登录用户点心形返回 401 并触发当前全局未登录处理。
- [ ] 已登录但未认证用户可以点心形。
- [ ] 未认证用户仍不能发布、收藏或递出联系申请。
- [ ] 推荐排序受新鲜度、类型、心形、收藏、联系申请、名片完整度影响。
- [ ] 发布者自己的心形不增加推荐排序权重。
- [ ] `recommendationScore` 不出现在任何 API 响应。
- [ ] 过期、下架、待审核、拒绝内容不进入公共 feed。
- [ ] `npm test`、`npm run build`、`npm run e2e` 全部通过。
- [ ] 验收通过后提醒用户重新讨论“我的委托 / 我发布的委托管理”。

## Self-Review

- Spec coverage: all V2 scope items map to Task 1 through Task 4; out-of-scope items are explicitly excluded in Global Constraints.
- Placeholder scan: no unresolved markers, no open-ended implementation placeholders, and every task has concrete files, snippets, commands, and expected outcomes.
- Type consistency: backend fields are consistently `reactionCount` and `reactedByMe`; channel values match the spec; frontend helper names match the imports used by `FeedPage`.
