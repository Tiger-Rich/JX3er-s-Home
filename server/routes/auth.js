import { Router } from 'express';

import {
  hashPassword,
  issueToken,
  loadCurrentUser,
  requireUser,
  verifyPassword,
} from '../auth.js';

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    const error = new Error(`${field} is required`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function loadProfile(db, userId) {
  return db.prepare('SELECT * FROM profiles WHERE userId = ?').get(userId);
}

function identityResponse(user, profile) {
  const { verificationStatus, ...safeUser } = user;
  return { user: safeUser, profile, verificationStatus };
}

export function createAuthRouter(db) {
  const router = Router();

  router.post('/register', (req, res, next) => {
    try {
      const account = requiredText(req.body?.account, 'account');
      requiredText(req.body?.password, 'password');
      const nickname = requiredText(req.body?.nickname, 'nickname');

      const createIdentity = db.transaction(() => {
        const result = db
          .prepare(
            `INSERT INTO users (account, passwordHash, nickname)
             VALUES (?, ?, ?)`,
          )
          .run(account, hashPassword(req.body.password), nickname);
        const userId = Number(result.lastInsertRowid);

        db.prepare('INSERT INTO profiles (userId) VALUES (?)').run(userId);
        db.prepare('INSERT INTO verifications (userId) VALUES (?)').run(userId);
        return userId;
      });

      let userId;
      try {
        userId = createIdentity();
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(409).json({ error: 'Account already exists' });
        }
        throw error;
      }

      const user = loadCurrentUser(db, userId);
      return res.status(201).json({
        token: issueToken(userId),
        ...identityResponse(user, loadProfile(db, userId)),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/login', (req, res, next) => {
    try {
      const account = requiredText(req.body?.account, 'account');
      requiredText(req.body?.password, 'password');
      const storedUser = db
        .prepare('SELECT id, passwordHash, status FROM users WHERE account = ?')
        .get(account);

      if (
        !storedUser ||
        storedUser.status !== 'active' ||
        !verifyPassword(req.body.password, storedUser.passwordHash)
      ) {
        return res.status(401).json({ error: 'Invalid account or password' });
      }

      const user = loadCurrentUser(db, storedUser.id);
      const { verificationStatus, ...safeUser } = user;
      return res.json({
        token: issueToken(user.id),
        user: safeUser,
        verificationStatus,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/me', requireUser(db), (req, res) => {
    return res.json(identityResponse(req.user, loadProfile(db, req.user.id)));
  });

  return router;
}

export default createAuthRouter;
