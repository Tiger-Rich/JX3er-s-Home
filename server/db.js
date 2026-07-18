import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(moduleDirectory, 'schema.sql'), 'utf8');

export function createDatabase(filename) {
  const db = new Database(filename);
  try {
    db.pragma('foreign_keys = ON');
    db.exec(schema);
    migrateDatabase(db);
    return db;
  } catch (error) {
    if (db.open) {
      db.close();
    }
    throw error;
  }
}

function migrateDatabase(db) {
  let requestColumns = db.pragma('table_info(requests)');
  if (!requestColumns.some(({ name }) => name === 'details')) {
    db.exec("ALTER TABLE requests ADD COLUMN details TEXT NOT NULL DEFAULT '{}'");
    requestColumns = db.pragma('table_info(requests)');
  }
  for (const [name, definition] of [
    ['withdrawnAt', 'TEXT'],
    ['closedAt', 'TEXT'],
    ['ownerHiddenAt', 'TEXT'],
  ]) {
    if (!requestColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE requests ADD COLUMN ${name} ${definition}`);
    }
  }
  const requestSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'requests'")
    .get().sql;
  if (!requestSql.includes("'withdrawn'") || !requestSql.includes("'closed'")) {
    rebuildRequestsForLifecycle(db);
  }
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
}

function rebuildRequestsForLifecycle(db) {
  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  try {
    db.transaction(() => {
      db.exec('ALTER TABLE requests RENAME TO requests_legacy');
      db.exec(`
        CREATE TABLE requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ownerId INTEGER NOT NULL,
          type TEXT NOT NULL CHECK (type IN (
            'job_referral', 'industry_consulting', 'trade', 'commission', 'local_help', 'other'
          )),
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '{}',
          city TEXT,
          remote INTEGER NOT NULL DEFAULT 0 CHECK (remote IN (0, 1)),
          industry TEXT,
          budgetOrReward TEXT,
          expiresAt TEXT NOT NULL CHECK (datetime(expiresAt) IS NOT NULL),
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
            'draft', 'pending', 'approved', 'rejected', 'taken_down', 'expired', 'withdrawn', 'closed'
          )),
          rejectReason TEXT,
          takedownReason TEXT,
          withdrawnAt TEXT,
          closedAt TEXT,
          ownerHiddenAt TEXT,
          createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (id, ownerId),
          FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      db.exec(`
        INSERT INTO requests (
          id, ownerId, type, title, description, details, city, remote,
          industry, budgetOrReward, expiresAt, status, rejectReason,
          takedownReason, withdrawnAt, closedAt, ownerHiddenAt, createdAt, updatedAt
        )
        SELECT
          id, ownerId, type, title, description, details, city, remote,
          industry, budgetOrReward, expiresAt, status, rejectReason,
          takedownReason, withdrawnAt, closedAt, ownerHiddenAt, createdAt, updatedAt
        FROM requests_legacy
      `);
      db.exec('DROP TABLE requests_legacy');
    })();
  } finally {
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

export function seedDatabase(db) {
  const seed = db.transaction(() => {
    const insertUser = db.prepare(`
      INSERT INTO users (
        account,
        passwordHash,
        nickname,
        city,
        contactValue,
        contactVisibleAfterApproval,
        role,
        status
      ) VALUES (
        @account,
        @passwordHash,
        @nickname,
        @city,
        @contactValue,
        @contactVisibleAfterApproval,
        @role,
        'active'
      )
      ON CONFLICT(account) DO NOTHING
    `);

    insertUser.run({
      account: 'admin',
      passwordHash: 'password:admin123',
      nickname: '万事屋掌柜',
      city: '上海',
      contactValue: null,
      contactVisibleAfterApproval: 0,
      role: 'admin',
    });
    insertUser.run({
      account: 'qixiu',
      passwordHash: 'password:test123',
      nickname: '云水间',
      city: '杭州',
      contactValue: 'qixiu-demo',
      contactVisibleAfterApproval: 1,
      role: 'user',
    });
    insertUser.run({
      account: 'wanhua',
      passwordHash: 'password:test123',
      nickname: '松风照影',
      city: '上海',
      contactValue: 'wanhua-demo',
      contactVisibleAfterApproval: 1,
      role: 'user',
    });

    const findUser = db.prepare(
      'SELECT id, role FROM users WHERE account = ?',
    );
    const requireSeedUser = (account, expectedRole) => {
      const user = findUser.get(account);
      if (!user) {
        throw new Error(`Seed account "${account}" was not created`);
      }
      if (user.role !== expectedRole) {
        throw new Error(
          `Seed account "${account}" must have role "${expectedRole}", found "${user.role}"`,
        );
      }
      return user.id;
    };
    const adminId = requireSeedUser('admin', 'admin');
    const qixiuId = requireSeedUser('qixiu', 'user');
    const wanhuaId = requireSeedUser('wanhua', 'user');

    const insertProfile = db.prepare(`
      INSERT OR IGNORE INTO profiles (
        userId,
        server,
        gameNickname,
        sect,
        startedYear,
        industry,
        occupation,
        canOffer,
        lookingFor
      ) VALUES (
        @userId,
        @server,
        @gameNickname,
        @sect,
        @startedYear,
        @industry,
        @occupation,
        @canOffer,
        @lookingFor
      )
    `);

    insertProfile.run({
      userId: qixiuId,
      server: '梦江南',
      gameNickname: '云水间',
      sect: '七秀',
      startedYear: 2016,
      industry: '互联网',
      occupation: '产品经理',
      canOffer: '简历梳理与产品岗位经验交流',
      lookingFor: '结识同城同门，交流副本与职业成长',
    });
    insertProfile.run({
      userId: wanhuaId,
      server: '唯我独尊',
      gameNickname: '松风照影',
      sect: '万花',
      startedYear: 2014,
      industry: '设计',
      occupation: '视觉设计师',
      canOffer: '作品集建议与品牌视觉经验分享',
      lookingFor: '寻找跨行业交流和周末同游伙伴',
    });

    const insertVerification = db.prepare(`
      INSERT OR IGNORE INTO verifications (
        userId,
        status,
        supportMaterial,
        reviewerId,
        reviewedAt
      ) VALUES (?, 'approved', ?, ?, CURRENT_TIMESTAMP)
    `);
    insertVerification.run(
      qixiuId,
      '本地原型演示认证：区服与游戏昵称已核对。',
      adminId,
    );
    insertVerification.run(
      wanhuaId,
      '本地原型演示认证：区服与游戏昵称已核对。',
      adminId,
    );

    db.prepare(`
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
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM requests WHERE ownerId = ? AND title = ?
      )
    `).run(
      qixiuId,
      'industry_consulting',
      '想了解游戏行业产品岗位的日常',
      '准备转向游戏行业，希望和有相关经验的同门聊聊岗位分工、作品准备与面试节奏。',
      JSON.stringify({
        topic: '游戏行业产品岗位',
        questions: '想了解岗位分工、作品准备与面试节奏',
        preferredFormat: '微信文字或语音',
        background: '准备转向游戏行业',
      }),
      '杭州',
      1,
      '游戏互联网',
      '一杯咖啡或等值感谢',
      '2027-06-30 23:59:59',
      'approved',
      qixiuId,
      '想了解游戏行业产品岗位的日常',
    );

    db.prepare(`
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
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM requests WHERE ownerId = ? AND title = ?
      )
    `).run(
      qixiuId,
      'other',
      '待撤回的种子委托',
      '用于演示委托撤回和重新提交的本地种子数据。',
      JSON.stringify({
        requestKind: 'E2E 重新提交',
        helpWanted: '验证撤回后的编辑和重新提交流程。',
        reward: '一杯咖啡或等值感谢',
        note: 'E2E pending request',
      }),
      '杭州',
      1,
      '游戏互联网',
      '一杯咖啡或等值感谢',
      '2027-06-30 23:59:59',
      'pending',
      qixiuId,
      '待撤回的种子委托',
    );

    db.prepare(`
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
        status,
        rejectReason
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM requests WHERE ownerId = ? AND title = ?
      )
    `).run(
      qixiuId,
      'other',
      '未通过的种子委托',
      '用于验证未通过委托不能直接重新提交的本地种子数据。',
      JSON.stringify({
        requestKind: 'E2E 未通过委托',
        helpWanted: '验证未通过状态没有编辑重新提交入口。',
        reward: '一杯咖啡或等值感谢',
        note: 'E2E rejected request',
      }),
      '杭州',
      1,
      '游戏互联网',
      '一杯咖啡或等值感谢',
      '2027-06-30 23:59:59',
      'rejected',
      'E2E 验证未通过',
      qixiuId,
      '未通过的种子委托',
    );

    db.prepare(`
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
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM requests WHERE ownerId = ? AND title = ?
      )
    `).run(
      qixiuId,
      'other',
      '待关闭的种子委托',
      '用于演示委托关闭和从列表中隐藏的本地种子数据。',
      JSON.stringify({ note: 'E2E approved request' }),
      '杭州',
      1,
      '游戏互联网',
      '一杯咖啡或等值感谢',
      '2027-06-30 23:59:59',
      'approved',
      qixiuId,
      '待关闭的种子委托',
    );
  });

  seed();
  return db;
}
