import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../server/app.js';
import { issueToken } from '../server/auth.js';
import { createDatabase } from '../server/db.js';

function expectNoPasswordHash(value) {
  expect(JSON.stringify(value)).not.toContain('passwordHash');
}

describe('identity API', () => {
  let app;
  let db;

  beforeEach(() => {
    db = createDatabase(':memory:');
    app = createApp(db);
  });

  afterEach(() => {
    db?.close();
  });

  async function register(overrides = {}) {
    return request(app)
      .post('/api/auth/register')
      .send({
        account: 'new-user',
        password: 'secret123',
        nickname: 'New User',
        ...overrides,
      });
  }

  it.each([
    ['account', undefined],
    ['account', '   '],
    ['password', undefined],
    ['password', '   '],
    ['nickname', undefined],
    ['nickname', '   '],
  ])(
    'requires a present, non-blank %s when registering',
    async (field, value) => {
      const response = await register({ [field]: value });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: `${field} is required` });
      expect(db.prepare('SELECT COUNT(*) AS count FROM users').get().count).toBe(
        0,
      );
    },
  );

  it('registers a user and creates its profile and initial verification atomically', async () => {
    const response = await register();

    expect(response.status).toBe(201);
    expect(response.body.token).toMatch(/^prototype:\d+$/);
    expect(response.body.user).toMatchObject({
      account: 'new-user',
      nickname: 'New User',
      role: 'user',
      status: 'active',
    });
    expect(response.body.profile).toMatchObject({
      userId: response.body.user.id,
      server: null,
      gameNickname: null,
    });
    expect(response.body.verificationStatus).toBe('not_submitted');
    expectNoPasswordHash(response.body);

    const stored = db
      .prepare(
        `SELECT u.account, u.passwordHash, p.userId AS profileUserId,
                v.userId AS verificationUserId, v.status
         FROM users u
         JOIN profiles p ON p.userId = u.id
         JOIN verifications v ON v.userId = u.id
         WHERE u.account = ?`,
      )
      .get('new-user');
    expect(stored).toEqual({
      account: 'new-user',
      passwordHash: 'password:secret123',
      profileUserId: response.body.user.id,
      verificationUserId: response.body.user.id,
      status: 'not_submitted',
    });
  });

  it('rejects duplicate accounts with 409', async () => {
    expect((await register()).status).toBe(201);

    const response = await register({ nickname: 'Duplicate' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBeTruthy();
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get().count).toBe(1);
  });

  it('logs in with correct credentials and returns a token and safe user', async () => {
    await register();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ account: 'new-user', password: 'secret123' });

    expect(response.status).toBe(200);
    expect(response.body.token).toMatch(/^prototype:\d+$/);
    expect(response.body.user).toMatchObject({
      account: 'new-user',
      nickname: 'New User',
      status: 'active',
    });
    expectNoPasswordHash(response.body);
  });

  it('rejects incorrect credentials and disabled users', async () => {
    await register();

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ account: 'new-user', password: 'wrong' });
    expect(wrongPassword.status).toBe(401);

    db.prepare("UPDATE users SET status = 'disabled' WHERE account = ?").run(
      'new-user',
    );
    const disabled = await request(app)
      .post('/api/auth/login')
      .send({ account: 'new-user', password: 'secret123' });
    expect(disabled.status).toBe(401);
  });

  it('returns the current user, profile, and verification status for a valid token', async () => {
    const registration = await register();

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${registration.body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      id: registration.body.user.id,
      account: 'new-user',
      nickname: 'New User',
    });
    expect(response.body.profile.userId).toBe(registration.body.user.id);
    expect(response.body.verificationStatus).toBe('not_submitted');
    expectNoPasswordHash(response.body);
  });

  it.each([
    ['a missing header', undefined],
    ['an unrelated scheme', 'Basic abc'],
    ['an empty token', 'Bearer '],
    ['an undefined ID', 'Bearer prototype:undefined'],
    ['a null ID', 'Bearer prototype:null'],
    ['a zero ID', 'Bearer prototype:0'],
    ['a negative ID', 'Bearer prototype:-1'],
    ['a fractional ID', 'Bearer prototype:1.5'],
    ['a malformed ID', 'Bearer prototype:abc'],
  ])('rejects %s on /api/auth/me', async (_label, authorization) => {
    const call = request(app).get('/api/auth/me');
    if (authorization !== undefined) call.set('Authorization', authorization);

    const response = await call;

    expect(response.status).toBe(401);
  });

  it('returns only the authenticated user own complete profile', async () => {
    const first = await register({
      account: 'first',
      nickname: 'First',
    });
    await register({ account: 'second', nickname: 'Second' });

    const response = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${first.body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      account: 'first',
      nickname: 'First',
      city: null,
      contactValue: null,
    });
    expect(response.body.profile).toMatchObject({
      userId: first.body.user.id,
      server: null,
      gameNickname: null,
      sect: null,
      startedYear: null,
      industry: null,
      occupation: null,
      canOffer: null,
      lookingFor: null,
    });
    expect(response.body.verificationStatus).toBe('not_submitted');
    expect(JSON.stringify(response.body)).not.toContain('second');
    expectNoPasswordHash(response.body);
  });

  it.each([
    ['server', undefined],
    ['server', '   '],
    ['gameNickname', undefined],
    ['gameNickname', '   '],
  ])(
    'requires a present, non-blank %s for verification submission',
    async (field, value) => {
      const registration = await register();
      const response = await request(app)
        .post('/api/profile/verification')
        .set('Authorization', `Bearer ${registration.body.token}`)
        .send({
          server: 'Dream River',
          gameNickname: 'Sword Heart',
          [field]: value,
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: `${field} is required` });
      expect(
        db
          .prepare('SELECT status FROM verifications WHERE userId = ?')
          .get(registration.body.user.id).status,
      ).toBe('not_submitted');
    },
  );

  it('updates the complete card and sets verification to pending', async () => {
    const registration = await register();
    const response = await request(app)
      .post('/api/profile/verification')
      .set('Authorization', `Bearer ${registration.body.token}`)
      .send({
        nickname: 'Updated Name',
        city: 'Hangzhou',
        contactValue: 'contact-me',
        server: ' Dream River ',
        gameNickname: ' Sword Heart ',
        sect: 'Seven Swords',
        startedYear: 2016,
        industry: 'Internet',
        occupation: 'Product Manager',
        canOffer: 'Resume reviews',
        lookingFor: 'Career exchange',
        supportMaterial: 'Character screenshot checked locally',
      });

    expect(response.status).toBe(200);
    expect(response.body.verificationStatus).toBe('pending');
    expect(response.body.user).toBeUndefined();
    expect(response.body.profile).toMatchObject({
      nickname: 'Updated Name',
      city: 'Hangzhou',
      contactValue: 'contact-me',
      server: 'Dream River',
      gameNickname: 'Sword Heart',
      sect: 'Seven Swords',
      startedYear: 2016,
      industry: 'Internet',
      occupation: 'Product Manager',
      canOffer: 'Resume reviews',
      lookingFor: 'Career exchange',
    });
    expect(JSON.stringify(response.body)).not.toContain('account');
    expectNoPasswordHash(response.body);

    expect(
      db
        .prepare(
          `SELECT u.nickname, u.city, u.contactValue, p.server,
                  p.gameNickname, p.industry, p.occupation, v.status,
                  v.supportMaterial
           FROM users u
           JOIN profiles p ON p.userId = u.id
           JOIN verifications v ON v.userId = u.id
           WHERE u.id = ?`,
        )
        .get(registration.body.user.id),
    ).toEqual({
      nickname: 'Updated Name',
      city: 'Hangzhou',
      contactValue: 'contact-me',
      server: 'Dream River',
      gameNickname: 'Sword Heart',
      industry: 'Internet',
      occupation: 'Product Manager',
      status: 'pending',
      supportMaterial: 'Character screenshot checked locally',
    });
  });

  it('blocks disabled users from protected profile routes', async () => {
    const registration = await register();
    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(
      registration.body.user.id,
    );

    const token = issueToken(registration.body.user.id);
    const getResponse = await request(app)
      .get('/api/profile')
      .set('Authorization', `Bearer ${token}`);
    const postResponse = await request(app)
      .post('/api/profile/verification')
      .set('Authorization', `Bearer ${token}`)
      .send({ server: 'Dream River', gameNickname: 'Sword Heart' });

    expect(getResponse.status).toBe(401);
    expect(postResponse.status).toBe(401);
  });
});
