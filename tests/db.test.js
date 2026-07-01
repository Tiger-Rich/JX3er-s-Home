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
      'verification statuses',
      "INSERT INTO verifications (userId, status) VALUES (1, 'unknown')",
    ],
    [
      'request types',
      "INSERT INTO requests (ownerId, type, title, description) VALUES (1, 'boosting', 'Bad type', 'Rejected by CHECK')",
    ],
    [
      'request statuses',
      "INSERT INTO requests (ownerId, type, title, description, status) VALUES (1, 'trade', 'Bad status', 'Rejected by CHECK', 'published')",
    ],
    [
      'request remote flags',
      "INSERT INTO requests (ownerId, type, title, description, remote) VALUES (1, 'trade', 'Bad remote', 'Rejected by CHECK', 2)",
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
