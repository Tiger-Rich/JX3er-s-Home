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
    return db;
  } catch (error) {
    if (db.open) {
      db.close();
    }
    throw error;
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
        city,
        remote,
        industry,
        budgetOrReward,
        expiresAt,
        status
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved'
      WHERE NOT EXISTS (
        SELECT 1 FROM requests WHERE ownerId = ? AND title = ?
      )
    `).run(
      qixiuId,
      'industry_consulting',
      '想了解游戏行业产品岗位的日常',
      '准备转向游戏行业，希望和有相关经验的同门聊聊岗位分工、作品准备与面试节奏。',
      '杭州',
      1,
      '游戏互联网',
      '一杯咖啡或等值感谢',
      '2027-06-30 23:59:59',
      qixiuId,
      '想了解游戏行业产品岗位的日常',
    );
  });

  seed();
  return db;
}
