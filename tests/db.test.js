import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, seedDatabase } from '../server/db.js';

const expectedTables = [
  'contact_applications',
  'favorites',
  'profiles',
  'reports',
  'requests',
  'users',
  'verifications',
];

describe('SQLite database', () => {
  let db;

  beforeEach(() => {
    db = createDatabase(':memory:');
  });

  afterEach(() => {
    db?.close();
  });

  it('creates every application table and enables foreign keys', () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map(({ name }) => name);

    expect(tables).toEqual(expectedTables);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() =>
      db.prepare('INSERT INTO profiles (userId) VALUES (?)').run(999),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it.each([
    [
      'user roles',
      "INSERT INTO users (account, passwordHash, nickname, role) VALUES ('bad-role', 'password:test', 'Bad Role', 'moderator')",
    ],
    [
      'user statuses',
      "INSERT INTO users (account, passwordHash, nickname, status) VALUES ('bad-status', 'password:test', 'Bad Status', 'pending')",
    ],
    [
      'contact visibility flags',
      "INSERT INTO users (account, passwordHash, nickname, contactVisibleAfterApproval) VALUES ('bad-visibility', 'password:test', 'Bad Visibility', 2)",
    ],
    [
      'verification statuses',
      "INSERT INTO verifications (userId, status) VALUES (1, 'unknown')",
    ],
    [
      'request types',
      "INSERT INTO requests (ownerId, type, title, description, expiresAt) VALUES (1, 'boosting', 'Bad type', 'Rejected by CHECK', '2027-01-01 00:00:00')",
    ],
    [
      'request statuses',
      "INSERT INTO requests (ownerId, type, title, description, expiresAt, status) VALUES (1, 'trade', 'Bad status', 'Rejected by CHECK', '2027-01-01 00:00:00', 'published')",
    ],
    [
      'request remote flags',
      "INSERT INTO requests (ownerId, type, title, description, remote, expiresAt) VALUES (1, 'trade', 'Bad remote', 'Rejected by CHECK', 2, '2027-01-01 00:00:00')",
    ],
    [
      'contact application statuses',
      "INSERT INTO contact_applications (requestId, applicantId, ownerId, status) VALUES (1, 2, 1, 'unknown')",
    ],
    [
      'report target types',
      "INSERT INTO reports (reporterId, targetType, targetId, reason) VALUES (1, 'profile', 1, 'Rejected by CHECK')",
    ],
    [
      'report statuses',
      "INSERT INTO reports (reporterId, targetType, targetId, reason, status) VALUES (1, 'user', 1, 'Rejected by CHECK', 'closed')",
    ],
  ])('rejects invalid %s with CHECK constraints', (_label, sql) => {
    seedDatabase(db);

    expect(() => db.exec(sql)).toThrow(/CHECK constraint failed/);
  });

  it.each([
    ['a missing expiration', null, /NOT NULL constraint failed/],
    ['an invalid expiration', 'not-a-date', /CHECK constraint failed/],
  ])('rejects requests with %s', (_label, expiresAt, expectedError) => {
    seedDatabase(db);
    const ownerId = db
      .prepare("SELECT id FROM users WHERE account = 'qixiu'")
      .get().id;
    const insertRequest = db.prepare(`
      INSERT INTO requests (ownerId, type, title, description, expiresAt)
      VALUES (?, 'trade', 'Invalid expiration', 'Must be rejected', ?)
    `);

    expect(() => insertRequest.run(ownerId, expiresAt)).toThrow(expectedError);
  });

  it('rejects a contact application whose owner does not own the request', () => {
    seedDatabase(db);
    const users = Object.fromEntries(
      db
        .prepare("SELECT account, id FROM users")
        .all()
        .map(({ account, id }) => [account, id]),
    );
    const requestId = db.prepare('SELECT id FROM requests LIMIT 1').get().id;

    expect(() =>
      db
        .prepare(
          'INSERT INTO contact_applications (requestId, applicantId, ownerId) VALUES (?, ?, ?)',
        )
        .run(requestId, users.wanhua, users.admin),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('rejects owners applying to their own requests', () => {
    seedDatabase(db);
    const request = db
      .prepare('SELECT id, ownerId FROM requests LIMIT 1')
      .get();

    expect(() =>
      db
        .prepare(
          'INSERT INTO contact_applications (requestId, applicantId, ownerId) VALUES (?, ?, ?)',
        )
        .run(request.id, request.ownerId, request.ownerId),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rolls back seeding when an existing seed account has the wrong role', () => {
    db.prepare(`
      INSERT INTO users (account, passwordHash, nickname, role)
      VALUES ('qixiu', 'password:existing', 'Existing account', 'admin')
    `).run();

    expect(() => seedDatabase(db)).toThrow(
      /Seed account "qixiu" must have role "user", found "admin"/,
    );
    expect(db.prepare('SELECT account, role FROM users').all()).toEqual([
      { account: 'qixiu', role: 'admin' },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM profiles').get().count).toBe(
      0,
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM requests').get().count).toBe(
      0,
    );
  });

  it('seeds prototype accounts, complete profiles, approvals, and a request', () => {
    seedDatabase(db);

    const users = db
      .prepare(
        "SELECT account, passwordHash, role FROM users WHERE account IN ('admin', 'qixiu', 'wanhua') ORDER BY account",
      )
      .all();
    expect(users).toEqual([
      { account: 'admin', passwordHash: 'password:admin123', role: 'admin' },
      { account: 'qixiu', passwordHash: 'password:test123', role: 'user' },
      { account: 'wanhua', passwordHash: 'password:test123', role: 'user' },
    ]);

    const profiles = db
      .prepare(
        `SELECT u.account, p.server, p.gameNickname, p.sect, p.industry,
                p.occupation, p.canOffer, p.lookingFor
         FROM profiles p
         JOIN users u ON u.id = p.userId
         WHERE u.account IN ('qixiu', 'wanhua')
         ORDER BY u.account`,
      )
      .all();
    expect(profiles).toHaveLength(2);
    for (const profile of profiles) {
      expect(profile.server).toBeTruthy();
      expect(profile.gameNickname).toBeTruthy();
      expect(profile.sect).toBeTruthy();
      expect(profile.industry).toBeTruthy();
      expect(profile.occupation).toBeTruthy();
      expect(profile.canOffer).toBeTruthy();
      expect(profile.lookingFor).toBeTruthy();
    }

    const approvals = db
      .prepare(
        `SELECT u.account, v.status
         FROM verifications v
         JOIN users u ON u.id = v.userId
         WHERE u.account IN ('qixiu', 'wanhua')
         ORDER BY u.account`,
      )
      .all();
    expect(approvals).toEqual([
      { account: 'qixiu', status: 'approved' },
      { account: 'wanhua', status: 'approved' },
    ]);

    const request = db
      .prepare(
        `SELECT type, status FROM requests
         WHERE type IN ('job_referral', 'industry_consulting')
           AND status = 'approved'
         LIMIT 1`,
      )
      .get();
    expect(request).toBeTruthy();
  });

  it('can seed repeatedly without creating duplicate records', () => {
    seedDatabase(db);
    const before = Object.fromEntries(
      expectedTables.map((table) => [
        table,
        db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      ]),
    );

    seedDatabase(db);
    const after = Object.fromEntries(
      expectedTables.map((table) => [
        table,
        db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      ]),
    );

    expect(after).toEqual(before);
  });
});
