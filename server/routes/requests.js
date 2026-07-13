import { Router } from 'express';

import { optionalUser, requireUser } from '../auth.js';
import { normalizeFeedQuery, sortFeedRows } from '../feedDiscovery.js';
import {
  REQUEST_TYPES,
  canApplyContact,
  canPublishRequest,
  isActiveVerifiedUser,
} from '../domain.js';
import {
  buildRequestDescription,
  normalizeRequestDetails,
  parseRequestDetails,
  requestIndustry,
} from '../requestDetails.js';
import {
  insertRequestImages,
  loadImagesForRequests,
  requestImageUpload,
} from '../requestImages.js';

const REQUEST_COLUMNS = `
  r.id, r.ownerId, r.type, r.title, r.description, r.details, r.city,
  r.remote, r.industry, r.budgetOrReward, r.expiresAt, r.status,
  r.createdAt, r.updatedAt,
  u.nickname AS ownerNickname, u.city AS ownerCity,
  p.server AS ownerServer, p.gameNickname AS ownerGameNickname,
  p.sect AS ownerSect, p.startedYear AS ownerStartedYear,
  p.industry AS ownerIndustry, p.occupation AS ownerOccupation,
  COALESCE(v.status, 'not_submitted') AS ownerVerificationStatus,
  COALESCE(rr.reactionCount, 0) AS reactionCount,
  COALESCE(fr.favoriteCount, 0) AS favoriteCount,
  COALESCE(ca.applicationCount, 0) AS applicationCount,
  COALESCE(orx.ownerReactionCount, 0) AS ownerReactionCount,
  CASE WHEN ? IS NULL THEN 0 ELSE EXISTS (
    SELECT 1 FROM request_reactions mine
    WHERE mine.requestId = r.id AND mine.userId = ?
  ) END AS reactedByMe
`;
const FEED_AGGREGATE_JOINS = `
       LEFT JOIN (
         SELECT requestId, COUNT(*) AS reactionCount
         FROM request_reactions
         GROUP BY requestId
       ) rr ON rr.requestId = r.id
       LEFT JOIN (
         SELECT requestId, COUNT(*) AS favoriteCount
         FROM favorites
         GROUP BY requestId
       ) fr ON fr.requestId = r.id
       LEFT JOIN (
         SELECT requestId, COUNT(*) AS applicationCount
         FROM contact_applications
         GROUP BY requestId
       ) ca ON ca.requestId = r.id
       LEFT JOIN (
         SELECT rr.requestId, COUNT(*) AS ownerReactionCount
         FROM request_reactions rr
         JOIN requests owned ON owned.id = rr.requestId
         WHERE rr.userId = owned.ownerId
         GROUP BY rr.requestId
       ) orx ON orx.requestId = r.id`;
const UTC_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.exposeToClient = true;
  return error;
}

function positiveId(value) {
  if (!/^[1-9]\d*$/.test(value)) throw clientError(400, 'Invalid ID');
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw clientError(400, 'Invalid ID');
  return id;
}

function requiredText(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw clientError(400, `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw clientError(400, `${field} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw clientError(400, `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw clientError(400, `${field} must be at most ${maxLength} characters`);
  }
  return normalized || null;
}

function parseMultipartDetails(value) {
  if (typeof value !== 'string') {
    throw clientError(400, 'details must be a JSON object');
  }
  try {
    return JSON.parse(value);
  } catch {
    throw clientError(400, 'details must be valid JSON');
  }
}

function parseRemote(value, multipart) {
  if (value === undefined) return false;
  if (multipart) {
    if (!['true', 'false'].includes(value)) {
      throw clientError(400, 'remote must be true or false');
    }
    return value === 'true';
  }
  if (typeof value !== 'boolean') {
    throw clientError(400, 'remote must be a boolean');
  }
  return value;
}

function futureUtcIso(value) {
  const input = requiredText(value, 'expiresAt', 64);
  if (input !== value || !UTC_ISO_PATTERN.test(input)) {
    throw clientError(400, 'expiresAt must be a valid future UTC ISO date');
  }

  const expiry = new Date(input);
  const normalized = Number.isNaN(expiry.getTime())
    ? null
    : expiry.toISOString();
  const canonicalInput = input.includes('.')
    ? input
    : input.replace('Z', '.000Z');
  if (
    !normalized ||
    normalized !== canonicalInput ||
    expiry.getTime() <= Date.now()
  ) {
    throw clientError(400, 'expiresAt must be a valid future UTC ISO date');
  }
  return normalized;
}

function requestDto(row, includeOwner = true) {
  const result = {
    id: row.id,
    ownerId: row.ownerId,
    type: row.type,
    title: row.title,
    description: row.description,
    details: parseRequestDetails(row.details),
    images: row.images ?? [],
    city: row.city,
    remote: Boolean(row.remote),
    industry: row.industry,
    budgetOrReward: row.budgetOrReward,
    expiresAt: row.expiresAt,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reactionCount: Number(row.reactionCount ?? 0),
    reactedByMe: Boolean(row.reactedByMe),
  };
  if (includeOwner) {
    result.owner = {
      nickname: row.ownerNickname,
      server: row.ownerServer,
      gameNickname: row.ownerGameNickname,
      sect: row.ownerSect,
      startedYear: row.ownerStartedYear,
      city: row.ownerCity,
      industry: row.ownerIndustry,
      occupation: row.ownerOccupation,
      verificationStatus: row.ownerVerificationStatus,
    };
  }
  return result;
}

function publicRequestById(db, id, userId = null) {
  return db
    .prepare(
      `SELECT ${REQUEST_COLUMNS}
       FROM requests r
       JOIN users u ON u.id = r.ownerId
       LEFT JOIN profiles p ON p.userId = u.id
       LEFT JOIN verifications v ON v.userId = u.id
       ${FEED_AGGREGATE_JOINS}
       WHERE r.id = ? AND r.status = 'approved' AND u.status = 'active'
         AND datetime(r.expiresAt) > datetime('now')`,
    )
    .get(userId, userId, id);
}

function reactionState(db, requestId, userId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS reactionCount,
              EXISTS (
                SELECT 1 FROM request_reactions
                WHERE requestId = ? AND userId = ?
              ) AS reactedByMe
       FROM request_reactions
       WHERE requestId = ?`,
    )
    .get(requestId, userId, requestId);
  return {
    reactionCount: Number(row.reactionCount ?? 0),
    reactedByMe: Boolean(row.reactedByMe),
  };
}

function requireVerified(permission) {
  return (req, res, next) => {
    if (!permission(req.user)) {
      return res.status(403).json({ error: 'Approved verification required' });
    }
    return next();
  };
}

export function createRequestsRouter(db) {
  const router = Router();

  function maybeUploadImages(req, res, next) {
    if (!req.is('multipart/form-data')) return next();
    return requestImageUpload(req, res, next);
  }

  router.get('/', optionalUser(db), (req, res, next) => {
    try {
      const feedQuery = normalizeFeedQuery(req.query);
      const meta = {};
      const clauses = [
        "r.status = 'approved'",
        "u.status = 'active'",
        "datetime(r.expiresAt) > datetime('now')",
      ];
      const values = [];
      if (feedQuery.typeFromChannel) {
        clauses.push('r.type = ?');
        values.push(feedQuery.typeFromChannel);
      }
      if (feedQuery.channel === 'nearby') {
        if (!req.user?.city) {
          return res.json({
            requests: [],
            meta: { nearbyCityRequired: true },
          });
        }
        clauses.push('r.city = ?');
        values.push(req.user.city);
        meta.nearbyCityRequired = false;
        meta.nearbyCity = req.user.city;
      }
      for (const field of ['type', 'city', 'industry']) {
        if (req.query[field] !== undefined) {
          if (typeof req.query[field] !== 'string' || !req.query[field].trim()) {
            throw clientError(400, `Invalid ${field} filter`);
          }
          clauses.push(`r.${field} = ?`);
          values.push(req.query[field].trim());
        }
      }
      if (req.query.remote !== undefined) {
        if (!['true', 'false'].includes(req.query.remote)) {
          throw clientError(400, 'remote must be true or false');
        }
        clauses.push('r.remote = ?');
        values.push(req.query.remote === 'true' ? 1 : 0);
      }

      const rows = db
        .prepare(
          `SELECT ${REQUEST_COLUMNS}
           FROM requests r
           JOIN users u ON u.id = r.ownerId
           LEFT JOIN profiles p ON p.userId = u.id
           LEFT JOIN verifications v ON v.userId = u.id
           ${FEED_AGGREGATE_JOINS}
           WHERE ${clauses.join(' AND ')}
           ORDER BY datetime(r.createdAt) DESC, r.id DESC`,
        )
        .all(req.user?.id ?? null, req.user?.id ?? null, ...values);
      const imagesByRequestId = loadImagesForRequests(
        db,
        rows.map((row) => row.id),
      );
      const sortedRows = sortFeedRows(rows, {
        channel: feedQuery.channel,
        sort: feedQuery.sort,
        typeFromChannel: feedQuery.typeFromChannel,
        viewer: req.user,
      });
      return res.json({
        requests: sortedRows.map((row) =>
          requestDto({ ...row, images: imagesByRequestId.get(row.id) ?? [] }),
        ),
        meta,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', optionalUser(db), (req, res, next) => {
    try {
      const row = publicRequestById(
        db,
        positiveId(req.params.id),
        req.user?.id ?? null,
      );
      if (!row) return res.status(404).json({ error: 'Request not found' });
      const images =
        loadImagesForRequests(db, [row.id]).get(row.id) ?? [];
      return res.json({ request: requestDto({ ...row, images }) });
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    '/',
    requireUser(db),
    requireVerified(canPublishRequest),
    maybeUploadImages,
    (req, res, next) => {
      try {
        const multipart = req.is('multipart/form-data');
        const files = req.files ?? [];
        const body = req.body ?? {};
        const type = requiredText(body.type, 'type', 40);
        if (!Object.hasOwn(REQUEST_TYPES, type)) {
          throw clientError(400, 'Invalid request type');
        }
        const title = requiredText(body.title, 'title', 160);
        const rawDetails = multipart
          ? parseMultipartDetails(body.details)
          : body.details;
        const details = normalizeRequestDetails(type, rawDetails);
        const description = buildRequestDescription(type, details);
        const city = optionalText(body.city, 'city', 80);
        const remote = parseRemote(body.remote, multipart);
        if (!city && !remote) {
          throw clientError(400, 'city or remote=true is required');
        }
        if (files.length > 0 && type !== 'trade') {
          throw clientError(400, 'Images are only allowed for trade requests');
        }
        const expiresAt = futureUtcIso(body.expiresAt);

        const values = {
          ownerId: req.user.id,
          type,
          title,
          description,
          details: JSON.stringify(details),
          city,
          remote: remote ? 1 : 0,
          industry: requestIndustry(
            type,
            details,
            optionalText(body.industry, 'industry', 120),
          ),
          budgetOrReward: optionalText(
            body.budgetOrReward,
            'budgetOrReward',
            500,
          ),
          expiresAt,
        };
        const createRequest = db.transaction(() => {
          const result = db
            .prepare(
              `INSERT INTO requests
                 (ownerId, type, title, description, details, city, remote,
                  industry, budgetOrReward, expiresAt, status)
               VALUES (@ownerId, @type, @title, @description, @details, @city,
                       @remote, @industry, @budgetOrReward, @expiresAt,
                       'pending')`,
            )
            .run(values);
          const requestId = Number(result.lastInsertRowid);
          const images = insertRequestImages(db, requestId, files);
          const row = db
            .prepare(
              `SELECT id, ownerId, type, title, description, details, city,
                      remote, industry, budgetOrReward, expiresAt, status,
                      createdAt, updatedAt
               FROM requests WHERE id = ?`,
            )
            .get(requestId);
          return { ...row, images };
        });
        return res
          .status(201)
          .json({ request: requestDto(createRequest(), false) });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post('/:id/reaction', requireUser(db), (req, res, next) => {
    try {
      const requestId = positiveId(req.params.id);
      if (!publicRequestById(db, requestId, req.user.id)) {
        return res.status(404).json({ error: 'Request not found' });
      }
      db.prepare(
        'INSERT OR IGNORE INTO request_reactions (userId, requestId) VALUES (?, ?)',
      ).run(req.user.id, requestId);
      return res.json(reactionState(db, requestId, req.user.id));
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id/reaction', requireUser(db), (req, res, next) => {
    try {
      const requestId = positiveId(req.params.id);
      if (!publicRequestById(db, requestId, req.user.id)) {
        return res.status(404).json({ error: 'Request not found' });
      }
      db.prepare(
        'DELETE FROM request_reactions WHERE userId = ? AND requestId = ?',
      ).run(req.user.id, requestId);
      return res.json(reactionState(db, requestId, req.user.id));
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    '/:id/favorite',
    requireUser(db),
    requireVerified(isActiveVerifiedUser),
    (req, res, next) => {
      try {
        const requestId = positiveId(req.params.id);
        if (!publicRequestById(db, requestId)) {
          return res.status(404).json({ error: 'Request not found' });
        }
        db.prepare(
          'INSERT OR IGNORE INTO favorites (userId, requestId) VALUES (?, ?)',
        ).run(req.user.id, requestId);
        return res.json({ favorited: true });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post('/:id/report', requireUser(db), (req, res, next) => {
    try {
      const targetId = positiveId(req.params.id);
      const reason = requiredText(req.body?.reason, 'reason', 500);
      const target = publicRequestById(db, targetId);
      if (!target) return res.status(404).json({ error: 'Request not found' });
      const result = db
        .prepare(
          `INSERT INTO reports (reporterId, targetType, targetId, reason, status)
           VALUES (?, 'request', ?, ?, 'pending')`,
        )
        .run(req.user.id, targetId, reason);
      return res.status(201).json({
        report: {
          id: Number(result.lastInsertRowid),
          reporterId: req.user.id,
          targetType: 'request',
          targetId,
          reason,
          status: 'pending',
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    '/:id/applications',
    requireUser(db),
    requireVerified(canApplyContact),
    (req, res, next) => {
      try {
        const requestId = positiveId(req.params.id);
        const message = requiredText(req.body?.message, 'message', 1000);
        const target = publicRequestById(db, requestId);
        if (!target) return res.status(404).json({ error: 'Request not found' });
        if (target.ownerId === req.user.id) {
          return res.status(409).json({ error: 'Cannot apply to your own request' });
        }
        let result;
        try {
          result = db
            .prepare(
              `INSERT INTO contact_applications
                 (requestId, applicantId, ownerId, message, status)
               VALUES (?, ?, ?, ?, 'pending')`,
            )
            .run(requestId, req.user.id, target.ownerId, message);
        } catch (error) {
          if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Application already exists' });
          }
          throw error;
        }
        return res.status(201).json({
          application: {
            id: Number(result.lastInsertRowid),
            requestId,
            applicantId: req.user.id,
            ownerId: target.ownerId,
            message,
            status: 'pending',
          },
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

export default createRequestsRouter;
