import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it.each([
    ['a non-string value', 123, 'nickname must be a string'],
    [
      'an overlong value',
      'x'.repeat(41),
      'nickname must be at most 40 characters',
    ],
  ])('rejects registration nickname with %s', async (_label, nickname, error) => {
    const response = await register({ nickname });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error });
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get().count).toBe(0);
  });

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
    expect(response.body.profile.server).toBeNull();
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

  it('returns only explicit public identity and profile DTO fields', async () => {
    const registration = await register();
    const authorization = `Bearer ${registration.body.token}`;
    const expectedUserFields = [
      'id',
      'account',
      'nickname',
      'city',
      'contactValue',
      'role',
      'status',
    ].sort();
    const expectedProfileFields = [
      'server',
      'gameNickname',
      'sect',
      'startedYear',
      'industry',
      'occupation',
      'canOffer',
      'lookingFor',
    ].sort();

    expect(Object.keys(registration.body.user).sort()).toEqual(
      expectedUserFields,
    );
    expect(Object.keys(registration.body.profile).sort()).toEqual(
      expectedProfileFields,
    );

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', authorization);
    const ownProfile = await request(app)
      .get('/api/profile')
      .set('Authorization', authorization);
    expect(Object.keys(me.body.user).sort()).toEqual(expectedUserFields);
    expect(Object.keys(me.body.profile).sort()).toEqual(expectedProfileFields);
    expect(Object.keys(ownProfile.body.user).sort()).toEqual(
      expectedUserFields,
    );
    expect(Object.keys(ownProfile.body.profile).sort()).toEqual(
      expectedProfileFields,
    );

    const submission = await request(app)
      .post('/api/profile/verification')
      .set('Authorization', authorization)
      .send({ server: 'Dream River', gameNickname: 'Sword Heart' });
    expect(Object.keys(submission.body.profile).sort()).toEqual(
      ['nickname', 'city', 'contactValue', ...expectedProfileFields].sort(),
    );
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

  it.each([
    'server',
    'gameNickname',
    'nickname',
    'city',
    'contactValue',
    'sect',
    'industry',
    'occupation',
    'canOffer',
    'lookingFor',
    'supportMaterial',
  ])('rejects a non-string %s before writing verification data', async (field) => {
    const registration = await register();
    const response = await request(app)
      .post('/api/profile/verification')
      .set('Authorization', `Bearer ${registration.body.token}`)
      .send({
        server: 'Dream River',
        gameNickname: 'Sword Heart',
        nickname: 'Unchanged Name',
        [field]: 123,
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: `${field} must be a string` });
    expect(
      db
        .prepare('SELECT nickname FROM users WHERE id = ?')
        .get(registration.body.user.id).nickname,
    ).toBe('New User');
    expect(
      db
        .prepare('SELECT status FROM verifications WHERE userId = ?')
        .get(registration.body.user.id).status,
    ).toBe('not_submitted');
  });

  it.each([
    ['a string', '2016'],
    ['a fraction', 2016.5],
    ['before the game launch', 2008],
    ['in the future', new Date().getFullYear() + 1],
  ])('rejects startedYear when it is %s', async (_label, startedYear) => {
    const registration = await register();
    const response = await request(app)
      .post('/api/profile/verification')
      .set('Authorization', `Bearer ${registration.body.token}`)
      .send({
        server: 'Dream River',
        gameNickname: 'Sword Heart',
        startedYear,
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: `startedYear must be an integer between 2009 and ${new Date().getFullYear()}`,
    });
    expect(
      db
        .prepare('SELECT status FROM verifications WHERE userId = ?')
        .get(registration.body.user.id).status,
    ).toBe('not_submitted');
  });

  it.each([
    ['server', 80],
    ['gameNickname', 80],
    ['nickname', 40],
    ['city', 40],
    ['contactValue', 160],
    ['sect', 40],
    ['industry', 80],
    ['occupation', 80],
    ['canOffer', 500],
    ['lookingFor', 500],
    ['supportMaterial', 500],
  ])('rejects %s longer than %i characters', async (field, maxLength) => {
    const registration = await register();
    const response = await request(app)
      .post('/api/profile/verification')
      .set('Authorization', `Bearer ${registration.body.token}`)
      .send({
        server: 'Dream River',
        gameNickname: 'Sword Heart',
        [field]: 'x'.repeat(maxLength + 1),
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: `${field} must be at most ${maxLength} characters`,
    });
    expect(
      db
        .prepare('SELECT status FROM verifications WHERE userId = ?')
        .get(registration.body.user.id).status,
    ).toBe('not_submitted');
  });

  it('normalizes optional blanks, preserves omitted fields, and allows clearing startedYear', async () => {
    const registration = await register();
    const userId = registration.body.user.id;
    db.prepare(
      `UPDATE users
       SET nickname = 'Existing Name', city = 'Existing City',
           contactValue = 'existing-contact'
       WHERE id = ?`,
    ).run(userId);
    db.prepare(
      `UPDATE profiles
       SET server = 'Old Server', gameNickname = 'Old Nickname', sect = 'Old Sect',
           startedYear = 2016, industry = 'Existing Industry',
           occupation = 'Existing Occupation', canOffer = 'Existing Offer',
           lookingFor = 'Existing Need'
       WHERE userId = ?`,
    ).run(userId);
    db.prepare(
      `UPDATE verifications
       SET status = 'rejected', supportMaterial = 'existing material'
       WHERE userId = ?`,
    ).run(userId);

    const response = await request(app)
      .post('/api/profile/verification')
      .set('Authorization', `Bearer ${registration.body.token}`)
      .send({
        server: 'New Server',
        gameNickname: 'New Nickname',
        city: '   ',
        sect: '   ',
        startedYear: null,
      });

    expect(response.status).toBe(200);
    expect(
      db
        .prepare(
          `SELECT u.nickname, u.city, u.contactValue, p.server, p.gameNickname,
                  p.sect, p.startedYear, p.industry, p.occupation, p.canOffer,
                  p.lookingFor, v.supportMaterial
           FROM users u
           JOIN profiles p ON p.userId = u.id
           JOIN verifications v ON v.userId = u.id
           WHERE u.id = ?`,
        )
        .get(userId),
    ).toEqual({
      nickname: 'Existing Name',
      city: null,
      contactValue: 'existing-contact',
      server: 'New Server',
      gameNickname: 'New Nickname',
      sect: null,
      startedYear: null,
      industry: 'Existing Industry',
      occupation: 'Existing Occupation',
      canOffer: 'Existing Offer',
      lookingFor: 'Existing Need',
      supportMaterial: 'existing material',
    });
  });

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

  it.each(['pending', 'approved'])(
    'rejects verification submission while status is %s without partial updates',
    async (status) => {
      const registration = await register();
      const reviewer = await register({
        account: `reviewer-${status}`,
        nickname: 'Reviewer',
      });
      const userId = registration.body.user.id;
      db.prepare(
        `UPDATE verifications
         SET status = ?, supportMaterial = ?, reviewerId = ?, reviewedAt = ?,
             rejectReason = ?
         WHERE userId = ?`,
      ).run(
        status,
        'existing material',
        reviewer.body.user.id,
        '2026-06-30 12:00:00',
        'existing reason',
        userId,
      );

      const beforeUser = db
        .prepare('SELECT nickname, city, contactValue FROM users WHERE id = ?')
        .get(userId);
      const beforeProfile = db
        .prepare(
          `SELECT server, gameNickname, sect, startedYear, industry,
                  occupation, canOffer, lookingFor
           FROM profiles WHERE userId = ?`,
        )
        .get(userId);
      const beforeVerification = db
        .prepare(
          `SELECT status, supportMaterial, reviewerId, reviewedAt, rejectReason
           FROM verifications WHERE userId = ?`,
        )
        .get(userId);

      const response = await request(app)
        .post('/api/profile/verification')
        .set('Authorization', `Bearer ${registration.body.token}`)
        .send({
          nickname: 'Must Not Change',
          city: 'Must Not Change',
          contactValue: 'must-not-change',
          server: 'Blocked Server',
          gameNickname: 'Blocked Nickname',
          occupation: 'Must Not Change',
          supportMaterial: 'replacement material',
        });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: 'Verification cannot be submitted in its current state',
      });
      expect(
        db
          .prepare('SELECT nickname, city, contactValue FROM users WHERE id = ?')
          .get(userId),
      ).toEqual(beforeUser);
      expect(
        db
          .prepare(
            `SELECT server, gameNickname, sect, startedYear, industry,
                    occupation, canOffer, lookingFor
             FROM profiles WHERE userId = ?`,
          )
          .get(userId),
      ).toEqual(beforeProfile);
      expect(
        db
          .prepare(
            `SELECT status, supportMaterial, reviewerId, reviewedAt, rejectReason
             FROM verifications WHERE userId = ?`,
          )
          .get(userId),
      ).toEqual(beforeVerification);
    },
  );

  it('allows rejected verification to be resubmitted and clears review metadata', async () => {
    const registration = await register();
    const reviewer = await register({
      account: 'rejected-reviewer',
      nickname: 'Reviewer',
    });
    const userId = registration.body.user.id;
    db.prepare(
      `UPDATE verifications
       SET status = 'rejected', supportMaterial = 'old material', reviewerId = ?,
           reviewedAt = '2026-06-30 12:00:00', rejectReason = 'old reason'
       WHERE userId = ?`,
    ).run(reviewer.body.user.id, userId);

    const response = await request(app)
      .post('/api/profile/verification')
      .set('Authorization', `Bearer ${registration.body.token}`)
      .send({
        server: 'Dream River',
        gameNickname: 'Sword Heart',
        supportMaterial: 'new material',
      });

    expect(response.status).toBe(200);
    expect(
      db
        .prepare(
          `SELECT status, supportMaterial, reviewerId, reviewedAt, rejectReason
           FROM verifications WHERE userId = ?`,
        )
        .get(userId),
    ).toEqual({
      status: 'pending',
      supportMaterial: 'new material',
      reviewerId: null,
      reviewedAt: null,
      rejectReason: null,
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

  it('returns a stable public error for malformed JSON', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"account":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid JSON body' });
    expect(JSON.stringify(response.body)).not.toContain('SyntaxError');
  });
});

describe('server startup', () => {
  it('exits normally after importing server/index.js without starting a listener', () => {
    const indexUrl = pathToFileURL(
      resolve(process.cwd(), 'server/index.js'),
    ).href;
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

  it('closes the database when the requested port is already in use', async () => {
    const blocker = createServer();
    blocker.listen(0, '127.0.0.1');
    await once(blocker, 'listening');
    const port = blocker.address().port;
    const tempDirectory = mkdtempSync(join(tmpdir(), 'fanshu-api-'));
    const databasePath = join(tempDirectory, 'conflict.db');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let server;
    let databaseDeleted = false;

    try {
      server = startServer({
        filename: databasePath,
        host: '127.0.0.1',
        port,
      });
      const [error] = await once(server, 'error');

      expect(error.code).toBe('EADDRINUSE');
      expect(server.listening).toBe(false);
      expect(logSpy).not.toHaveBeenCalled();

      try {
        rmSync(databasePath);
        databaseDeleted = true;
      } catch {
        databaseDeleted = false;
      }
      expect(databaseDeleted).toBe(true);
    } finally {
      logSpy.mockRestore();
      if (!databaseDeleted && server && existsSync(databasePath)) {
        server.emit('close');
      }
      if (blocker.listening) {
        await new Promise((resolveClose, rejectClose) => {
          blocker.close((error) =>
            error ? rejectClose(error) : resolveClose(),
          );
        });
      }
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
