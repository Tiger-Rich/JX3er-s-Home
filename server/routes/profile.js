import { Router } from 'express';

import { loadCurrentUser, requireUser } from '../auth.js';

function loadProfile(db, userId) {
  return db
    .prepare(
      `SELECT server, gameNickname, sect, startedYear, industry, occupation,
              canOffer, lookingFor
       FROM profiles WHERE userId = ?`,
    )
    .get(userId);
}

function loadVerification(db, userId) {
  return db
    .prepare(
      `SELECT status, supportMaterial, rejectReason
       FROM verifications WHERE userId = ?`,
    )
    .get(userId);
}

function safeUser(user) {
  const { verificationStatus, ...result } = user;
  return result;
}

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.exposeToClient = true;
  return error;
}

function requiredText(value, field, maxLength) {
  if (value === undefined || value === null) {
    throw clientError(400, `${field} is required`);
  }
  if (typeof value !== 'string') {
    throw clientError(400, `${field} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized) throw clientError(400, `${field} is required`);
  if (normalized.length > maxLength) {
    throw clientError(
      400,
      `${field} must be at most ${maxLength} characters`,
    );
  }
  return normalized;
}

function optionalText(body, field, currentValue, maxLength) {
  if (!Object.hasOwn(body, field)) return currentValue;
  if (typeof body[field] !== 'string') {
    throw clientError(400, `${field} must be a string`);
  }

  const normalized = body[field].trim();
  if (normalized.length > maxLength) {
    throw clientError(
      400,
      `${field} must be at most ${maxLength} characters`,
    );
  }
  return normalized || null;
}

function optionalStartedYear(body, currentValue) {
  if (!Object.hasOwn(body, 'startedYear')) return currentValue;
  if (body.startedYear === null) return null;

  const currentYear = new Date().getFullYear();
  if (
    !Number.isInteger(body.startedYear) ||
    body.startedYear < 2009 ||
    body.startedYear > currentYear
  ) {
    throw clientError(
      400,
      `startedYear must be an integer between 2009 and ${currentYear}`,
    );
  }
  return body.startedYear;
}

function cardResponse(user, profile) {
  return {
    nickname: user.nickname,
    city: user.city,
    contactValue: user.contactValue,
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
      verification: loadVerification(db, req.user.id),
    });
  });

  router.post('/verification', (req, res, next) => {
    try {
      const body = req.body ?? {};
      const currentUser = loadCurrentUser(db, req.user.id);
      const currentProfile = loadProfile(db, req.user.id);
      const currentVerification = db
        .prepare('SELECT supportMaterial FROM verifications WHERE userId = ?')
        .get(req.user.id);
      const nextContactValue = Object.hasOwn(body, 'contactValue')
        ? requiredText(body.contactValue, 'contactValue', 160)
        : currentUser.contactValue;
      const values = {
        server: requiredText(body.server, 'server', 80),
        gameNickname: requiredText(
          body.gameNickname,
          'gameNickname',
          80,
        ),
        nickname: Object.hasOwn(body, 'nickname')
          ? requiredText(body.nickname, 'nickname', 40)
          : currentUser.nickname,
        city: optionalText(body, 'city', currentUser.city, 40),
        contactValue: nextContactValue,
        sect: optionalText(body, 'sect', currentProfile.sect, 40),
        startedYear: optionalStartedYear(body, currentProfile.startedYear),
        industry: optionalText(
          body,
          'industry',
          currentProfile.industry,
          80,
        ),
        occupation: optionalText(
          body,
          'occupation',
          currentProfile.occupation,
          80,
        ),
        canOffer: optionalText(
          body,
          'canOffer',
          currentProfile.canOffer,
          500,
        ),
        lookingFor: optionalText(
          body,
          'lookingFor',
          currentProfile.lookingFor,
          500,
        ),
        supportMaterial: optionalText(
          body,
          'supportMaterial',
          currentVerification.supportMaterial,
          500,
        ),
      };
      if (!values.contactValue) {
        throw clientError(400, 'contactValue is required');
      }

      const submitVerification = db.transaction(() => {
        const verificationUpdate = db.prepare(
          `UPDATE verifications
           SET status = 'pending', supportMaterial = ?, reviewerId = NULL,
               reviewedAt = NULL, rejectReason = NULL,
               updatedAt = CURRENT_TIMESTAMP
           WHERE userId = ? AND status IN ('not_submitted', 'rejected')`,
        ).run(values.supportMaterial, req.user.id);
        if (verificationUpdate.changes === 0) {
          throw clientError(
            409,
            'Verification cannot be submitted in its current state',
          );
        }

        db.prepare(
          `UPDATE users
           SET nickname = ?, city = ?, contactValue = ?, updatedAt = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).run(
          values.nickname,
          values.city,
          values.contactValue,
          req.user.id,
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
          ...values,
        });

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
