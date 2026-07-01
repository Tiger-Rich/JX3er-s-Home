import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../server/app.js';
import { issueToken } from '../server/auth.js';
import { createDatabase } from '../server/db.js';
import { startServer } from '../server/index.js';

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

  it('rolls back registration and hides internal details when profile creation fails', async () => {
    db.exec(`
      CREATE TRIGGER fail_profile_insert
      BEFORE INSERT ON profiles
      BEGIN
        SELECT RAISE(ABORT, 'forced profile failure');
      END
    `);

    const response = await register({ account: 'rollback-user' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(response.body)).not.toContain('stack');
    expect(JSON.stringify(response.body)).not.toContain('forced profile failure');
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM users WHERE account = ?')
        .get('rollback-user').count,
    ).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM profiles').get().count).toBe(
      0,
    );
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM verifications').get().count,
    ).toBe(0);
  });

  it('binds registration values without interpreting SQL-like input', async () => {
    const account = "quote'; DROP TABLE users; --";
    const nickname = "O'Brien'); DELETE FROM profiles; --";

    const response = await register({ account, nickname });

    expect(response.status).toBe(201);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'users'",
        )
        .get().count,
    ).toBe(1);
    expect(
      db.prepare('SELECT account, nickname FROM users WHERE id = ?').get(
        response.body.user.id,
      ),
    ).toEqual({ account, nickname });
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

  it('adds CORS headers to the health endpoint', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'https://example.test');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeTruthy();
  });
});

describe('server startup', () => {
  it('exits normally after importing server/index.js without starting a listener', () => {
    const indexUrl = pathToFileURL(
      resolve(process.cwd(), 'server/index.js'),
    ).href;
    const startedAt = Date.now();
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `await import(${JSON.stringify(indexUrl)});`,
      ],
      {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(3000);
  });

  it('binds to localhost and seeds accounts before accepting requests', async () => {
    const server = startServer({
      filename: ':memory:',
      host: '127.0.0.1',
      port: 0,
    });

    try {
      if (!server.listening) await once(server, 'listening');
      const address = server.address();

      expect(address).toMatchObject({ address: '127.0.0.1', family: 'IPv4' });
      expect(address.port).toBeGreaterThan(0);

      const login = await request(server)
        .post('/api/auth/login')
        .send({ account: 'admin', password: 'admin123' });
      expect(login.status).toBe(200);
      expect(login.body.user).toMatchObject({ account: 'admin', role: 'admin' });
    } finally {
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    }
  });
});
