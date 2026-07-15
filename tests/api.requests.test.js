import request from 'supertest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../server/app.js';
import { issueToken } from '../server/auth.js';
import { createDatabase, seedDatabase } from '../server/db.js';
import { REQUEST_IMAGE_DIRECTORY } from '../server/requestImages.js';

const FUTURE = '2099-12-31T23:59:59.000Z';
const PAST = '2020-01-01T00:00:00.000Z';
const FORBIDDEN_KEYS = [
  'passwordHash',
  'contactValue',
  'supportMaterial',
  'openid',
  'anonymous',
];

function auth(userId) {
  return { Authorization: `Bearer ${issueToken(userId)}` };
}

function expectNoKeys(value, keys = FORBIDDEN_KEYS) {
  const serialized = JSON.stringify(value);
  for (const key of keys) expect(serialized).not.toContain(`\"${key}\"`);
}

function validDetails(type = 'commission', overrides = {}) {
  const detailsByType = {
    job_referral: {
      targetRole: 'Product Manager',
      targetIndustry: 'Internet',
      careerStage: 'Mid-level',
      helpWanted: 'Referral and resume feedback',
      targetCompany: 'Example Co',
      resumeHighlights: 'Shipped growth projects',
      extraNote: 'Prefer async first.',
    },
    industry_consulting: {
      topic: 'Game industry product roles',
      questions: 'How should I prepare portfolio case studies?',
      preferredFormat: 'Video chat',
      background: 'Transitioning from SaaS.',
      expectedPeer: 'Product lead',
      reward: 'Coffee',
      extraNote: 'Weekends work best.',
    },
    trade: {
      itemName: 'Mechanical keyboard',
      price: '300 RMB',
      condition: 'Lightly used',
      deliveryMethod: 'Local pickup',
      negotiable: 'Yes',
      afterSalesBoundary: 'No return after inspection',
      extraNote: 'Can include spare keycaps.',
    },
    commission: {
      commissionContent: 'Portfolio review',
      deliverables: 'Written feedback',
      budget: 'Coffee',
      deadline: 'Next Friday',
      styleReference: 'Product design hiring bar',
      usage: 'Personal job search',
      commercialUse: 'No',
      extraNote: 'Focus on storytelling.',
    },
    local_help: {
      helpTask: 'Move a desk',
      area: 'Hangzhou Xihu',
      timeWindow: 'Saturday afternoon',
      headcount: '2 people',
      costShare: 'Dinner covered',
      safetyNote: 'Public community space',
      extraNote: 'Elevator available.',
    },
    other: {
      requestKind: 'Study group',
      helpWanted: 'Find peers for mock interviews',
      reward: 'Mutual practice',
      background: 'Preparing for interviews.',
      constraints: 'Remote only',
      extraNote: 'Evenings preferred.',
    },
  };
  return { ...detailsByType[type], ...overrides };
}

describe('request, contact, and admin API', () => {
  let app;
  let db;
  let users;

  beforeEach(() => {
    db = createDatabase(':memory:');
    seedDatabase(db);
    app = createApp(db);
    users = Object.fromEntries(
      db
        .prepare('SELECT account, id FROM users')
        .all()
        .map(({ account, id }) => [account, id]),
    );
  });

  afterEach(() => {
    db?.close();
    rmSync('uploads', { recursive: true, force: true });
  });

  function insertUser({
    account,
    nickname = account,
    role = 'user',
    status = 'active',
    verificationStatus = 'approved',
    contactValue = `${account}-contact`,
  }) {
    const result = db
      .prepare(
        `INSERT INTO users
           (account, passwordHash, nickname, city, contactValue, role, status)
         VALUES (?, 'password:test123', ?, 'Chengdu', ?, ?, ?)`,
      )
      .run(account, nickname, contactValue, role, status);
    const userId = Number(result.lastInsertRowid);
    db.prepare(
      `INSERT INTO profiles
         (userId, server, gameNickname, sect, startedYear, industry, occupation)
       VALUES (?, 'Dream River', ?, 'Qixiu', 2018, 'Technology', 'Engineer')`,
    ).run(userId, `${nickname} Game`);
    db.prepare(
      `INSERT INTO verifications (userId, status, supportMaterial)
       VALUES (?, ?, 'private proof')`,
    ).run(userId, verificationStatus);
    return userId;
  }

  function insertRequest({
    ownerId = users.qixiu,
    type = 'other',
    title = `Request ${Math.random()}`,
    status = 'approved',
    expiresAt = FUTURE,
    city = 'Hangzhou',
    remote = 0,
    industry = 'Technology',
    details = validDetails(type),
  } = {}) {
    const result = db
      .prepare(
         `INSERT INTO requests
           (ownerId, type, title, description, city, remote, industry,
            budgetOrReward, expiresAt, status, details)
         VALUES (?, ?, ?, 'Detailed request', ?, ?, ?, 'Coffee', ?, ?, ?)`,
      )
      .run(
        ownerId,
        type,
        title,
        city,
        remote,
        industry,
        expiresAt,
        status,
        JSON.stringify(details),
      );
    return Number(result.lastInsertRowid);
  }

  async function publish(ownerId = users.qixiu, overrides = {}) {
    return request(app)
      .post('/api/requests')
      .set(auth(ownerId))
      .send({
        type: 'commission',
        title: 'Need a portfolio review',
        description: 'Please review one product design portfolio.',
        details: validDetails('commission'),
        city: 'Hangzhou',
        remote: false,
        industry: 'Design',
        budgetOrReward: 'Coffee',
        expiresAt: FUTURE,
        anonymous: true,
        ...overrides,
      });
  }

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

  it('keeps withdrawn, closed, and owner-hidden requests out of public results', async () => {
    const withdrawnId = insertRequest({ status: 'withdrawn', title: 'Withdrawn public' });
    const closedId = insertRequest({ status: 'closed', title: 'Closed public' });
    const hiddenId = insertRequest({ title: 'Hidden public' });
    db.prepare('UPDATE requests SET ownerHiddenAt = CURRENT_TIMESTAMP WHERE id = ?').run(hiddenId);

    const feed = await request(app).get('/api/requests');
    const withdrawn = await request(app).get(`/api/requests/${withdrawnId}`);
    const closed = await request(app).get(`/api/requests/${closedId}`);
    const hidden = await request(app).get(`/api/requests/${hiddenId}`);

    expect(feed.body.requests.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining([withdrawnId, closedId, hiddenId]),
    );
    expect(withdrawn.status).toBe(404);
    expect(closed.status).toBe(404);
    expect(hidden.status).toBe(404);
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

  it('resubmits withdrawn requests only and rejects direct edits for other states', async () => {
    const withdrawnId = insertRequest({ status: 'withdrawn', title: 'Old withdrawn' });
    const approvedId = insertRequest({ status: 'approved', title: 'Published' });
    const rejectedId = insertRequest({ status: 'rejected', title: 'Rejected request' });

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
    const rejected = await request(app)
      .put(`/api/my/requests/${rejectedId}`)
      .set(auth(users.qixiu))
      .send({
        type: 'other',
        title: 'Rejected update',
        city: 'Hangzhou',
        remote: false,
        industry: 'Technology',
        budgetOrReward: 'Coffee',
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
    expect(rejected.status).toBe(409);
  });

  it.each([
    ['rejected', 'active', 403],
    ['approved', 'disabled', 401],
  ])(
    'does not let a %s and %s owner resubmit a withdrawn request',
    async (verificationStatus, accountStatus, expectedStatus) => {
      const ownerId = insertUser({
        account: `resubmit-${verificationStatus}-${accountStatus}`,
        verificationStatus,
        status: accountStatus,
      });
      const withdrawnId = insertRequest({ ownerId, status: 'withdrawn' });

      const response = await request(app)
        .put(`/api/my/requests/${withdrawnId}`)
        .set(auth(ownerId))
        .send({
          type: 'other',
          title: 'Must remain withdrawn',
          city: 'Hangzhou',
          remote: false,
          industry: 'Technology',
          budgetOrReward: 'Coffee',
          expiresAt: FUTURE,
          details: validDetails('other'),
        });

      expect(response.status).toBe(expectedStatus);
      expect(db.prepare('SELECT status FROM requests WHERE id = ?').get(withdrawnId).status)
        .toBe('withdrawn');
    },
  );

  it('rejects changing a withdrawn trade request with images to a non-trade type', async () => {
    const withdrawnId = insertRequest({ status: 'withdrawn', type: 'trade' });
    db.prepare(
      `INSERT INTO request_images (requestId, url, mimeType, sizeBytes, sortOrder)
       VALUES (?, '/uploads/request-images/legacy.png', 'image/png', 12, 0)`,
    ).run(withdrawnId);

    const response = await request(app)
      .put(`/api/my/requests/${withdrawnId}`)
      .set(auth(users.qixiu))
      .send({
        type: 'other',
        title: 'Should remain withdrawn',
        city: 'Hangzhou',
        remote: false,
        industry: 'Technology',
        budgetOrReward: 'Coffee',
        expiresAt: FUTURE,
        details: validDetails('other'),
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/trade|images/i);
    expect(db.prepare('SELECT status, type FROM requests WHERE id = ?').get(withdrawnId)).toEqual({
      status: 'withdrawn',
      type: 'trade',
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM request_images WHERE requestId = ?').get(withdrawnId).count,
    ).toBe(1);
  });

  it('publishes a pending non-anonymous request for an approved owner', async () => {
    const response = await publish();

    expect(response.status).toBe(201);
    expect(response.body.request).toMatchObject({
      ownerId: users.qixiu,
      type: 'commission',
      title: 'Need a portfolio review',
      description:
        '委托内容：Portfolio review；交付物：Written feedback；预算：Coffee；交付时间：Next Friday；补充说明：Focus on storytelling.',
      details: validDetails('commission'),
      status: 'pending',
      remote: false,
      expiresAt: FUTURE,
    });
    expectNoKeys(response.body, ['anonymous', 'contactValue', 'passwordHash']);

    const columns = db.prepare('PRAGMA table_info(requests)').all();
    expect(columns.map(({ name }) => name)).not.toContain('anonymous');
    expect(
      db
        .prepare(
          `SELECT ownerId, status, title, remote FROM requests WHERE id = ?`,
        )
        .get(response.body.request.id),
    ).toEqual({
      ownerId: users.qixiu,
      status: 'pending',
      title: 'Need a portfolio review',
      remote: 0,
    });
  });

  it('publishes trade images and returns them in public and admin DTOs', async () => {
    const response = await multipartPublish(
      users.qixiu,
      {
        type: 'trade',
        title: 'Sweet potato gift box',
        city: 'Hangzhou',
        remote: 'false',
        industry: 'Design',
        expiresAt: FUTURE,
        details: validDetails('trade'),
      },
      [
        {
          filename: 'sweet-potato.png',
          contentType: 'image/png',
          content: 'fake png bytes',
        },
      ],
    );

    expect(response.status).toBe(201);
    expect(response.body.request).toMatchObject({
      type: 'trade',
      details: validDetails('trade'),
      images: [
        expect.objectContaining({
          id: expect.any(Number),
          url: expect.stringMatching(/^\/uploads\/request-images\/.+\.png$/),
          mimeType: 'image/png',
          sizeBytes: expect.any(Number),
          sortOrder: 0,
        }),
      ],
    });

    const approval = await request(app)
      .post(`/api/admin/requests/${response.body.request.id}/approve`)
      .set(auth(users.admin));
    expect(approval.status).toBe(200);
    expect(approval.body.request).toMatchObject({
      details: validDetails('trade'),
      images: response.body.request.images,
    });

    const detail = await request(app).get(
      `/api/requests/${response.body.request.id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.request.images).toEqual(response.body.request.images);

    const adminList = await request(app)
      .get('/api/admin/requests?type=trade')
      .set(auth(users.admin));
    expect(adminList.status).toBe(200);
    expect(adminList.body.requests).toContainEqual(
      expect.objectContaining({
        id: response.body.request.id,
        details: validDetails('trade'),
        images: response.body.request.images,
      }),
    );
  });

  it('rejects images on non-trade multipart publications', async () => {
    const response = await multipartPublish(
      users.qixiu,
      {
        type: 'commission',
        title: 'Portfolio review',
        remote: 'true',
        expiresAt: FUTURE,
        details: validDetails('commission'),
      },
      [
        {
          filename: 'portfolio.png',
          contentType: 'image/png',
          content: 'fake png bytes',
        },
      ],
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('trade');
  });

  it('rejects unsupported trade image types', async () => {
    const response = await multipartPublish(
      users.qixiu,
      {
        type: 'trade',
        title: 'Keyboard',
        remote: 'true',
        expiresAt: FUTURE,
        details: validDetails('trade'),
      },
      [
        {
          filename: 'keyboard.gif',
          contentType: 'image/gif',
          content: 'fake gif bytes',
        },
      ],
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('image');
  });

  it('rejects more than six trade images', async () => {
    const response = await multipartPublish(
      users.qixiu,
      {
        type: 'trade',
        title: 'Keyboard',
        remote: 'true',
        expiresAt: FUTURE,
        details: validDetails('trade'),
      },
      Array.from({ length: 7 }, (_, index) => ({
        filename: `keyboard-${index}.png`,
        contentType: 'image/png',
        content: `fake png bytes ${index}`,
      })),
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('image');
  });

  it.each([
    [
      'job_referral',
      '目标岗位：Product Manager；目标行业：Internet；当前阶段：Mid-level；希望获得：Referral and resume feedback；补充说明：Prefer async first.',
      'Internet',
    ],
    [
      'industry_consulting',
      '咨询方向：Game industry product roles；具体问题：How should I prepare portfolio case studies?；交流方式：Video chat；补充说明：Weekends work best.',
      'Game industry product roles',
    ],
    [
      'trade',
      '物品：Mechanical keyboard；价格：300 RMB；成色/规格：Lightly used；交易方式：Local pickup；补充说明：Can include spare keycaps.',
      'Design',
    ],
    [
      'commission',
      '委托内容：Portfolio review；交付物：Written feedback；预算：Coffee；交付时间：Next Friday；补充说明：Focus on storytelling.',
      'Design',
    ],
    [
      'local_help',
      '互助事项：Move a desk；地点：Hangzhou Xihu；时间：Saturday afternoon；人数：2 people；补充说明：Elevator available.',
      'Design',
    ],
    [
      'other',
      '事情类型：Study group；希望帮助：Find peers for mock interviews；回报方式：Mutual practice；补充说明：Evenings preferred.',
      'Design',
    ],
  ])(
    'publishes %s with typed details and a generated description',
    async (type, expectedDescription, expectedIndustry) => {
      const response = await publish(users.qixiu, {
        type,
        description: 'Client supplied description must be ignored.',
        details: validDetails(type),
      });

      expect(response.status).toBe(201);
      expect(response.body.request).toMatchObject({
        type,
        details: validDetails(type),
        description: expectedDescription,
        industry: expectedIndustry,
      });
      expect(
        db
          .prepare(
            'SELECT description, details, industry FROM requests WHERE id = ?',
          )
          .get(response.body.request.id),
      ).toEqual({
        description: expectedDescription,
        details: JSON.stringify(validDetails(type)),
        industry: expectedIndustry,
      });
    },
  );

  it('rejects unknown request type publications', async () => {
    const response = await publish(users.qixiu, {
      type: 'boosting',
      details: validDetails('other'),
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid request type' });
  });

  it('rejects publication when a required typed detail is missing', async () => {
    const response = await publish(users.qixiu, {
      type: 'commission',
      details: validDetails('commission', { deadline: '   ' }),
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'deadline is required' });
  });

  it('lets an admin approve a request and exposes safe public list/detail DTOs', async () => {
    const published = await publish();
    const requestId = published.body.request.id;

    const approval = await request(app)
      .post(`/api/admin/requests/${requestId}/approve`)
      .set(auth(users.admin));
    expect(approval.status).toBe(200);
    expect(approval.body.request.status).toBe('approved');

    const list = await request(app).get(
      '/api/requests?type=commission&city=Hangzhou&industry=Design&remote=false',
    );
    const detail = await request(app).get(`/api/requests/${requestId}`);

    expect(list.status).toBe(200);
    expect(list.body.requests.map(({ id }) => id)).toContain(requestId);
    expect(detail.status).toBe(200);
    expect(detail.body.request).toMatchObject({
      id: requestId,
      status: 'approved',
      owner: {
        nickname: expect.any(String),
        server: expect.any(String),
        gameNickname: expect.any(String),
        verificationStatus: 'approved',
      },
    });
    expectNoKeys(list.body);
    expectNoKeys(detail.body);
  });

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
      referralId,
      consultingId,
    ]);
    expect(latest.body.requests.map(({ id }) => id)).toEqual([
      otherId,
      consultingId,
      referralId,
    ]);
  });

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

  it('does not let an owner self-heart outrank an otherwise identical request', async () => {
    db.prepare('DELETE FROM request_reactions').run();
    db.prepare('DELETE FROM requests').run();

    const selfHeartId = insertRequest({
      title: 'Owner heart only',
      type: 'other',
      ownerId: users.qixiu,
    });
    const neutralId = insertRequest({
      title: 'No hearts',
      type: 'other',
      ownerId: users.wanhua,
    });
    db.prepare(
      `UPDATE requests SET createdAt = '2026-07-14 00:00:00' WHERE id IN (?, ?)`,
    ).run(selfHeartId, neutralId);
    db.prepare(
      'INSERT INTO request_reactions (userId, requestId) VALUES (?, ?)',
    ).run(users.qixiu, selfHeartId);

    const response = await request(app).get(
      '/api/requests?channel=recommended&sort=recommended',
    );

    expect(response.status).toBe(200);
    expect(response.body.requests.map(({ id }) => id)).toEqual([
      neutralId,
      selfHeartId,
    ]);
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

  it('reveals only the counterparty contact after owner approval', async () => {
    const applicantId = insertUser({ account: 'applicant' });
    const strangerId = insertUser({ account: 'stranger' });
    const requestId = insertRequest();

    const applied = await request(app)
      .post(`/api/requests/${requestId}/applications`)
      .set(auth(applicantId))
      .send({ message: ' I can help with this. ', ownerId: strangerId });
    expect(applied.status).toBe(201);
    expect(applied.body.application).toMatchObject({
      requestId,
      applicantId,
      ownerId: users.qixiu,
      message: 'I can help with this.',
      status: 'pending',
    });
    expectNoKeys(applied.body, ['contactValue']);

    const applicationId = applied.body.application.id;
    const ownerBefore = await request(app)
      .get(`/api/contact/${applicationId}`)
      .set(auth(users.qixiu));
    const applicantBefore = await request(app)
      .get('/api/contact')
      .set(auth(applicantId));
    const strangerBefore = await request(app)
      .get(`/api/contact/${applicationId}`)
      .set(auth(strangerId));
    expectNoKeys(ownerBefore.body, ['contactValue']);
    expectNoKeys(applicantBefore.body, ['contactValue']);
    expect(strangerBefore.status).toBe(403);
    expectNoKeys(strangerBefore.body, ['contactValue']);

    const approval = await request(app)
      .post(`/api/contact/${applicationId}/approve`)
      .set(auth(users.qixiu));
    expect(approval.status).toBe(200);
    expect(approval.body.application).toMatchObject({
      status: 'approved',
      contactValue: 'applicant-contact',
    });

    const applicantAfter = await request(app)
      .get(`/api/contact/${applicationId}`)
      .set(auth(applicantId));
    const ownerAfter = await request(app)
      .get('/api/contact')
      .set(auth(users.qixiu));
    const strangerAfter = await request(app)
      .get(`/api/contact/${applicationId}`)
      .set(auth(strangerId));
    expect(applicantAfter.body.application.contactValue).toBe('qixiu-demo');
    expect(ownerAfter.body.applications).toContainEqual(
      expect.objectContaining({
        id: applicationId,
        direction: 'incoming',
        contactValue: 'applicant-contact',
      }),
    );
    expect(strangerAfter.status).toBe(403);
    expectNoKeys(strangerAfter.body, ['contactValue']);
  });

  it('enforces application ownership, uniqueness, and pending transitions', async () => {
    const applicantId = insertUser({ account: 'contact-applicant' });
    const strangerId = insertUser({ account: 'contact-stranger' });
    const requestId = insertRequest();

    const own = await request(app)
      .post(`/api/requests/${requestId}/applications`)
      .set(auth(users.qixiu))
      .send({ message: 'Self application' });
    expect(own.status).toBe(409);

    const first = await request(app)
      .post(`/api/requests/${requestId}/applications`)
      .set(auth(applicantId))
      .send({ message: 'Please connect' });
    const duplicate = await request(app)
      .post(`/api/requests/${requestId}/applications`)
      .set(auth(applicantId))
      .send({ message: 'Again' });
    expect(duplicate.status).toBe(409);

    const applicationId = first.body.application.id;
    const nonOwner = await request(app)
      .post(`/api/contact/${applicationId}/reject`)
      .set(auth(strangerId))
      .send({ reason: 'irrelevant' });
    expect(nonOwner.status).toBe(403);

    const rejected = await request(app)
      .post(`/api/contact/${applicationId}/reject`)
      .set(auth(users.qixiu))
      .send({ reason: 'No capacity' });
    const repeated = await request(app)
      .post(`/api/contact/${applicationId}/approve`)
      .set(auth(users.qixiu));
    expect(rejected.status).toBe(200);
    expect(rejected.body.application.status).toBe('rejected');
    expect(repeated.status).toBe(409);
    expectNoKeys(rejected.body, ['contactValue', 'reason']);
  });

  it.each([
    ['taken down', { status: 'taken_down', expiresAt: FUTURE }],
    ['expired', { status: 'approved', expiresAt: PAST }],
  ])(
    'does not approve contact after its request is %s but still permits rejection',
    async (label, lifecycle) => {
      const applicantId = insertUser({
        account: `lifecycle-${label.replace(' ', '-')}`,
      });
      const requestId = insertRequest();
      const applied = await request(app)
        .post(`/api/requests/${requestId}/applications`)
        .set(auth(applicantId))
        .send({ message: 'Apply before the lifecycle changes' });
      const applicationId = applied.body.application.id;
      db.prepare(
        'UPDATE requests SET status = ?, expiresAt = ? WHERE id = ?',
      ).run(lifecycle.status, lifecycle.expiresAt, requestId);

      const approval = await request(app)
        .post(`/api/contact/${applicationId}/approve`)
        .set(auth(users.qixiu));
      const ownerView = await request(app)
        .get(`/api/contact/${applicationId}`)
        .set(auth(users.qixiu));
      const applicantView = await request(app)
        .get(`/api/contact/${applicationId}`)
        .set(auth(applicantId));
      const rejection = await request(app)
        .post(`/api/contact/${applicationId}/reject`)
        .set(auth(users.qixiu));

      expect(approval.status).toBe(409);
      expect(ownerView.body.application.status).toBe('pending');
      expect(applicantView.body.application.status).toBe('pending');
      expectNoKeys(ownerView.body, ['contactValue']);
      expectNoKeys(applicantView.body, ['contactValue']);
      expect(rejection.status).toBe(200);
      expect(rejection.body.application.status).toBe('rejected');
      expectNoKeys(rejection.body, ['contactValue']);
    },
  );

  it.each([
    ['not_submitted', 'active', 403],
    ['pending', 'active', 403],
    ['rejected', 'active', 403],
    ['approved', 'disabled', 401],
  ])(
    'blocks %s verification with %s account from publishing and applying',
    async (verificationStatus, status, expectedStatus) => {
      const userId = insertUser({
        account: `blocked-${verificationStatus}-${status}`,
        verificationStatus,
        status,
      });
      const requestId = insertRequest();

      const publication = await publish(userId);
      const application = await request(app)
        .post(`/api/requests/${requestId}/applications`)
        .set(auth(userId))
        .send({ message: 'Blocked' });

      expect(publication.status).toBe(expectedStatus);
      expect(application.status).toBe(expectedStatus);
    },
  );

  it('requires authentication and approved verification for favorites', async () => {
    const requestId = insertRequest();
    const pendingId = insertUser({
      account: 'pending-favorite',
      verificationStatus: 'pending',
    });

    const anonymous = await request(app).post(
      `/api/requests/${requestId}/favorite`,
    );
    const pending = await request(app)
      .post(`/api/requests/${requestId}/favorite`)
      .set(auth(pendingId));
    const first = await request(app)
      .post(`/api/requests/${requestId}/favorite`)
      .set(auth(users.wanhua));
    const second = await request(app)
      .post(`/api/requests/${requestId}/favorite`)
      .set(auth(users.wanhua));

    expect(anonymous.status).toBe(401);
    expect(pending.status).toBe(403);
    expect(first.body).toEqual({ favorited: true });
    expect(second.body).toEqual({ favorited: true });
    expect(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM favorites WHERE userId = ? AND requestId = ?',
        )
        .get(users.wanhua, requestId).count,
    ).toBe(1);
  });

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

  it('creates bound pending reports for public requests and validates reason', async () => {
    const requestId = insertRequest();
    const blank = await request(app)
      .post(`/api/requests/${requestId}/report`)
      .set(auth(users.wanhua))
      .send({ reason: '   ' });
    const missing = await request(app)
      .post('/api/requests/999999/report')
      .set(auth(users.wanhua))
      .send({ reason: 'Missing target' });
    const created = await request(app)
      .post(`/api/requests/${requestId}/report`)
      .set(auth(users.wanhua))
      .send({ reason: " suspicious'; DROP TABLE reports; -- " });

    expect(blank.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(created.status).toBe(201);
    expect(created.body.report).toMatchObject({
      targetType: 'request',
      targetId: requestId,
      reason: "suspicious'; DROP TABLE reports; --",
      status: 'pending',
    });
  });

  it.each([
    ['pending', { status: 'pending', expiresAt: FUTURE }],
    ['rejected', { status: 'rejected', expiresAt: FUTURE }],
    ['taken down', { status: 'taken_down', expiresAt: FUTURE }],
    ['expired', { status: 'approved', expiresAt: PAST }],
    [
      'disabled owner',
      { status: 'approved', expiresAt: FUTURE, disabled: true },
    ],
  ])('does not create a report for a %s request', async (_label, hidden) => {
    const requestId = insertRequest(hidden);
    if (hidden.disabled) {
      db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(
        users.qixiu,
      );
    }
    const before = db
      .prepare('SELECT COUNT(*) AS count FROM reports')
      .get().count;

    const response = await request(app)
      .post(`/api/requests/${requestId}/report`)
      .set(auth(users.wanhua))
      .send({ reason: 'Hidden target' });

    expect(response.status).toBe(404);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM reports').get().count,
    ).toBe(before);
  });

  it.each([
    ['rejected', FUTURE],
    ['taken_down', FUTURE],
    ['approved', PAST],
  ])('hides %s requests expiring at %s from public list and detail', async (status, expiresAt) => {
    const requestId = insertRequest({ status, expiresAt });

    const list = await request(app).get('/api/requests');
    const detail = await request(app).get(`/api/requests/${requestId}`);

    expect(list.body.requests.map(({ id }) => id)).not.toContain(requestId);
    expect(detail.status).toBe(404);
  });

  it('hides an approved request everywhere after its owner is disabled', async () => {
    const applicantId = insertUser({ account: 'disabled-owner-applicant' });
    const requestId = insertRequest();

    const disabled = await request(app)
      .post(`/api/admin/users/${users.qixiu}/disable`)
      .set(auth(users.admin));
    const list = await request(app).get('/api/requests');
    const detail = await request(app).get(`/api/requests/${requestId}`);
    const favorite = await request(app)
      .post(`/api/requests/${requestId}/favorite`)
      .set(auth(applicantId));
    const application = await request(app)
      .post(`/api/requests/${requestId}/applications`)
      .set(auth(applicantId))
      .send({ message: 'This should no longer be available' });

    expect(disabled.status).toBe(200);
    expect(list.body.requests.map(({ id }) => id)).not.toContain(requestId);
    expect(detail.status).toBe(404);
    expect(favorite.status).toBe(404);
    expect(application.status).toBe(404);
  });

  it('validates publication fields, location, future UTC expiry, and positive IDs', async () => {
    const invalidType = await publish(users.qixiu, { type: 'account_trade' });
    const noLocation = await publish(users.qixiu, {
      city: ' ',
      remote: false,
    });
    const expired = await publish(users.qixiu, { expiresAt: PAST });
    const invalidId = await request(app).get('/api/requests/not-an-id');

    expect(invalidType.status).toBe(400);
    expect(noLocation.status).toBe(400);
    expect(expired.status).toBe(400);
    expect(invalidId.status).toBe(400);
  });

  it.each([
    ['slash date', '12/31/2099'],
    ['local date-time', '2099-12-31T23:59:59'],
    ['offset date-time', '2099-12-31T23:59:59+08:00'],
    ['whitespace-wrapped UTC date-time', ' 2099-12-31T23:59:59Z '],
    ['invalid calendar date', '2099-02-30T00:00:00Z'],
  ])(
    'rejects %s expiry with a stable error and no insert',
    async (_label, expiresAt) => {
      const before = db
        .prepare('SELECT COUNT(*) AS count FROM requests')
        .get().count;

      const response = await publish(users.qixiu, { expiresAt });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'expiresAt must be a valid future UTC ISO date',
      });
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM requests').get().count,
      ).toBe(before);
    },
  );

  it('normalizes an accepted UTC ISO expiry before storing it', async () => {
    const response = await publish(users.qixiu, {
      expiresAt: '2099-12-31T23:59:59Z',
    });

    expect(response.status).toBe(201);
    expect(response.body.request.expiresAt).toBe(FUTURE);
    expect(
      db
        .prepare('SELECT expiresAt FROM requests WHERE id = ?')
        .get(response.body.request.id).expiresAt,
    ).toBe(FUTURE);
  });

  it('shows verification contact only to authenticated administrators', async () => {
    const pendingId = insertUser({
      account: 'verification-pending',
      verificationStatus: 'pending',
    });
    const rejectedId = insertUser({
      account: 'verification-rejected',
      verificationStatus: 'pending',
    });

    const anonymous = await request(app).get(
      '/api/admin/verifications?status=pending',
    );
    const nonAdmin = await request(app)
      .get('/api/admin/verifications?status=pending')
      .set(auth(users.qixiu));
    const list = await request(app)
      .get('/api/admin/verifications?status=pending')
      .set(auth(users.admin));
    const publicRequests = await request(app).get('/api/requests');
    const reviewedRequests = await request(app)
      .get('/api/admin/requests')
      .set(auth(users.admin));

    expect(anonymous.status).toBe(401);
    expect(nonAdmin.status).toBe(403);
    expect(list.status).toBe(200);
    expect(list.body.verifications).toContainEqual(
      expect.objectContaining({
        userId: pendingId,
        status: 'pending',
        supportMaterial: 'private proof',
        contactValue: 'verification-pending-contact',
        user: expect.objectContaining({
          account: 'verification-pending',
          nickname: 'verification-pending',
        }),
        profile: expect.objectContaining({ server: 'Dream River' }),
      }),
    );
    expectNoKeys(list.body, ['passwordHash', 'openid']);
    expectNoKeys(publicRequests.body, ['contactValue']);
    expectNoKeys(reviewedRequests.body, ['contactValue']);

    const approved = await request(app)
      .post(`/api/admin/verifications/${pendingId}/approve`)
      .set(auth(users.admin));
    const rejected = await request(app)
      .post(`/api/admin/verifications/${rejectedId}/reject`)
      .set(auth(users.admin))
      .send({ reason: ' Insufficient proof ' });
    const repeated = await request(app)
      .post(`/api/admin/verifications/${pendingId}/approve`)
      .set(auth(users.admin));

    expect(approved.body.verification).toMatchObject({
      status: 'approved',
      reviewerId: users.admin,
      rejectReason: null,
    });
    expect(rejected.body.verification).toMatchObject({
      status: 'rejected',
      reviewerId: users.admin,
      rejectReason: 'Insufficient proof',
    });
    expect(repeated.status).toBe(409);
  });

  it('rejects unsigned and tampered prototype tokens on admin verification routes', async () => {
    const signedToken = issueToken(users.admin);
    const [prefix, userId, signature] = signedToken.split(':');
    const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;

    const unsigned = await request(app)
      .get('/api/admin/verifications?status=pending')
      .set('Authorization', 'Bearer prototype:1');
    const tampered = await request(app)
      .get('/api/admin/verifications?status=pending')
      .set('Authorization', `Bearer ${prefix}:${userId}:${tamperedSignature}`);

    expect(unsigned.status).toBe(401);
    expect(tampered.status).toBe(401);
  });

  it('allows only active admins to review requests with conditional transitions', async () => {
    const pendingApprove = insertRequest({ status: 'pending' });
    const pendingReject = insertRequest({ status: 'pending' });
    const approvedTakeDown = insertRequest({ status: 'approved' });
    const nonAdmin = await request(app)
      .get('/api/admin/requests')
      .set(auth(users.qixiu));
    expect(nonAdmin.status).toBe(403);

    const list = await request(app)
      .get('/api/admin/requests?status=pending&type=other&city=Hangzhou')
      .set(auth(users.admin));
    expect(list.status).toBe(200);
    expect(list.body.requests.map(({ id }) => id)).toEqual(
      expect.arrayContaining([pendingApprove, pendingReject]),
    );
    expectNoKeys(list.body);

    const approved = await request(app)
      .post(`/api/admin/requests/${pendingApprove}/approve`)
      .set(auth(users.admin));
    const rejected = await request(app)
      .post(`/api/admin/requests/${pendingReject}/reject`)
      .set(auth(users.admin))
      .send({ reason: ' Outside scope ' });
    const takenDown = await request(app)
      .post(`/api/admin/requests/${approvedTakeDown}/takedown`)
      .set(auth(users.admin))
      .send({ reason: ' Policy violation ' });
    const repeated = await request(app)
      .post(`/api/admin/requests/${pendingApprove}/reject`)
      .set(auth(users.admin))
      .send({ reason: 'Too late' });

    expect(approved.body.request.status).toBe('approved');
    expect(rejected.body.request).toMatchObject({
      status: 'rejected',
      rejectReason: 'Outside scope',
    });
    expect(takenDown.body.request).toMatchObject({
      status: 'taken_down',
      takedownReason: 'Policy violation',
    });
    expect(repeated.status).toBe(409);
  });

  it.each(['not_submitted', 'rejected'])(
    'does not let an admin approve a pending request for a %s owner',
    async (verificationStatus) => {
      const ownerId = insertUser({
        account: `unverified-owner-${verificationStatus}`,
        verificationStatus,
      });
      const requestId = insertRequest({ ownerId, status: 'pending' });

      const response = await request(app)
        .post(`/api/admin/requests/${requestId}/approve`)
        .set(auth(users.admin));

      expect(response.status).toBe(409);
      expect(db.prepare('SELECT status FROM requests WHERE id = ?').get(requestId).status)
        .toBe('pending');
    },
  );

  it('lets admins hard delete requests and cascades request-owned records', async () => {
    const requestId = insertRequest({ status: 'closed', title: 'Delete me' });
    db.prepare('INSERT INTO request_reactions (userId, requestId) VALUES (?, ?)').run(users.wanhua, requestId);
    db.prepare('INSERT INTO favorites (userId, requestId) VALUES (?, ?)').run(users.wanhua, requestId);
    db.prepare(
      `INSERT INTO contact_applications (requestId, applicantId, ownerId, message)
       VALUES (?, ?, ?, 'Interested')`,
    ).run(requestId, users.wanhua, users.qixiu);
    db.prepare(
      `INSERT INTO reports (reporterId, targetType, targetId, reason)
       VALUES (?, 'request', ?, 'Delete target report')`,
    ).run(users.wanhua, requestId);
    const imageFilename = 'delete-me.png';
    mkdirSync(REQUEST_IMAGE_DIRECTORY, { recursive: true });
    writeFileSync(path.join(REQUEST_IMAGE_DIRECTORY, imageFilename), 'image bytes');
    db.prepare(
      `INSERT INTO request_images (requestId, url, mimeType, sizeBytes, sortOrder)
       VALUES (?, ?, 'image/png', 11, 0)`,
    ).run(requestId, `/uploads/request-images/${imageFilename}`);

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
    expect(db.prepare('SELECT COUNT(*) AS count FROM contact_applications WHERE requestId = ?').get(requestId).count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM request_images WHERE requestId = ?').get(requestId).count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM reports WHERE targetType = 'request' AND targetId = ?").get(requestId).count).toBe(0);
    expect(existsSync(path.join(REQUEST_IMAGE_DIRECTORY, imageFilename))).toBe(false);
  });

  it.each([
    ['expired', { expiresAt: PAST }],
    ['owned by a disabled user', { disableOwner: true }],
  ])(
    'does not approve a pending request that is %s',
    async (_label, invalid) => {
      const requestId = insertRequest({
        status: 'pending',
        expiresAt: invalid.expiresAt,
      });
      if (invalid.disableOwner) {
        db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(
          users.qixiu,
        );
      }

      const response = await request(app)
        .post(`/api/admin/requests/${requestId}/approve`)
        .set(auth(users.admin));

      expect(response.status).toBe(409);
      expect(
        db.prepare('SELECT status FROM requests WHERE id = ?').get(requestId)
          .status,
      ).toBe('pending');
    },
  );

  it('filters reviewed requests by industry and expiration state', async () => {
    const expiredTechnology = insertRequest({
      industry: 'Technology',
      expiresAt: PAST,
    });
    const currentTechnology = insertRequest({
      industry: 'Technology',
      expiresAt: FUTURE,
    });
    const expiredDesign = insertRequest({
      industry: 'Design',
      expiresAt: PAST,
    });

    const expired = await request(app)
      .get('/api/admin/requests?industry=Technology&expired=true')
      .set(auth(users.admin));
    const current = await request(app)
      .get('/api/admin/requests?industry=Technology&expired=false')
      .set(auth(users.admin));
    const invalid = await request(app)
      .get('/api/admin/requests?expired=1')
      .set(auth(users.admin));

    expect(expired.status).toBe(200);
    expect(expired.body.requests.map(({ id }) => id)).toContain(
      expiredTechnology,
    );
    expect(expired.body.requests.map(({ id }) => id)).not.toContain(
      currentTechnology,
    );
    expect(expired.body.requests.map(({ id }) => id)).not.toContain(
      expiredDesign,
    );
    expect(current.status).toBe(200);
    expect(current.body.requests.map(({ id }) => id)).toContain(
      currentTechnology,
    );
    expect(current.body.requests.map(({ id }) => id)).not.toContain(
      expiredTechnology,
    );
    expect(invalid.status).toBe(400);
  });

  it('lists safe filtered users and disables users without allowing admin self-lockout or admin-on-admin disable', async () => {
    const targetId = insertUser({
      account: 'disable-target',
      nickname: 'Target Person',
    });
    const peerAdminId = insertUser({
      account: 'peer-admin',
      nickname: 'Peer Admin',
      role: 'admin',
    });
    const list = await request(app)
      .get(
        '/api/admin/users?nickname=Target&server=Dream&city=Chengdu&industry=Technology&verificationStatus=approved&status=active',
      )
      .set(auth(users.admin));

    expect(list.status).toBe(200);
    expect(list.body.users).toContainEqual(
      expect.objectContaining({
        id: targetId,
        nickname: 'Target Person',
        city: 'Chengdu',
        verificationStatus: 'approved',
        status: 'active',
      }),
    );
    expectNoKeys(list.body, ['passwordHash', 'contactValue', 'openid']);

    const self = await request(app)
      .post(`/api/admin/users/${users.admin}/disable`)
      .set(auth(users.admin));
    const peerAdmin = await request(app)
      .post(`/api/admin/users/${peerAdminId}/disable`)
      .set(auth(users.admin));
    const disabled = await request(app)
      .post(`/api/admin/users/${targetId}/disable`)
      .set(auth(users.admin));
    const repeated = await request(app)
      .post(`/api/admin/users/${targetId}/disable`)
      .set(auth(users.admin));

    expect(self.status).toBe(409);
    expect(peerAdmin.status).toBe(409);
    expect(
      db.prepare('SELECT status FROM users WHERE id = ?').get(peerAdminId).status,
    ).toBe('active');
    expect(disabled.body.user).toMatchObject({
      id: targetId,
      status: 'disabled',
    });
    expect(repeated.status).toBe(409);
  });
});
