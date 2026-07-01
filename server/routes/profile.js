import { Router } from 'express';

import { loadCurrentUser, requireUser } from '../auth.js';

const profileFields = [
  'sect',
  'startedYear',
  'industry',
  'occupation',
  'canOffer',
  'lookingFor',
];

function loadProfile(db, userId) {
  return db.prepare('SELECT * FROM profiles WHERE userId = ?').get(userId);
}

function safeUser(user) {
  const { verificationStatus, ...result } = user;
  return result;
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    const error = new Error(`${field} is required`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function optionalText(body, field, currentValue) {
  if (!Object.hasOwn(body, field)) return currentValue;
  if (typeof body[field] !== 'string') return body[field] ?? null;
  return body[field].trim() || null;
}

function cardResponse(user, profile) {
  return {
    nickname: user.nickname,
    city: user.city,
    contactValue: user.contactValue,
    contactVisibleAfterApproval: user.contactVisibleAfterApproval,
    ...profile,
  };
}

export function createProfileRouter(db) {
  const router = Router();
  router.use(requireUser(db));

  router.get('/', (req, res) => {
    return res.json({
      user: safeUser(req.user),
      profile: loadProfile(db, req.user.id),
      verificationStatus: req.user.verificationStatus,
    });
  });

  router.post('/verification', (req, res, next) => {
    try {
      const body = req.body ?? {};
      const server = requiredText(body.server, 'server');
      const gameNickname = requiredText(body.gameNickname, 'gameNickname');

      const submitVerification = db.transaction(() => {
        const currentUser = loadCurrentUser(db, req.user.id);
        const currentProfile = loadProfile(db, req.user.id);
        const nickname = Object.hasOwn(body, 'nickname')
          ? requiredText(body.nickname, 'nickname')
          : currentUser.nickname;

        db.prepare(
          `UPDATE users
           SET nickname = ?, city = ?, contactValue = ?, updatedAt = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).run(
          nickname,
          optionalText(body, 'city', currentUser.city),
          optionalText(body, 'contactValue', currentUser.contactValue),
          req.user.id,
        );

        const nextProfile = Object.fromEntries(
          profileFields.map((field) => [
            field,
            field === 'startedYear'
              ? Object.hasOwn(body, field)
                ? body[field]
                : currentProfile[field]
              : optionalText(body, field, currentProfile[field]),
          ]),
        );
        db.prepare(
          `UPDATE profiles
           SET server = @server,
               gameNickname = @gameNickname,
               sect = @sect,
               startedYear = @startedYear,
               industry = @industry,
               occupation = @occupation,
               canOffer = @canOffer,
               lookingFor = @lookingFor,
               updatedAt = CURRENT_TIMESTAMP
           WHERE userId = @userId`,
        ).run({
          userId: req.user.id,
          server,
          gameNickname,
          ...nextProfile,
        });

        db.prepare(
          `UPDATE verifications
           SET status = 'pending', supportMaterial = ?, reviewerId = NULL,
               reviewedAt = NULL, rejectReason = NULL,
               updatedAt = CURRENT_TIMESTAMP
           WHERE userId = ?`,
        ).run(optionalText(body, 'supportMaterial', null), req.user.id);
      });

      submitVerification();
      const user = loadCurrentUser(db, req.user.id);
      const profile = loadProfile(db, req.user.id);
      return res.json({
        profile: cardResponse(user, profile),
        verificationStatus: user.verificationStatus,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createProfileRouter;
