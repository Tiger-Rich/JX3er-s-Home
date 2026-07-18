import { Router } from 'express';

import { requireUser } from '../auth.js';
import {
  REQUEST_STATUSES,
  REQUEST_TYPES,
  VERIFICATION_STATUSES,
  isAdmin,
} from '../domain.js';
import { parseRequestDetails } from '../requestDetails.js';
import { deleteRequestImageFiles, loadImagesForRequests } from '../requestImages.js';

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

function requiredText(value, field, maxLength = 500) {
  if (typeof value !== 'string' || !value.trim()) {
    throw clientError(400, `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw clientError(400, `${field} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function publicOwner(row) {
  return {
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

function reviewedRequestDto(row) {
  return {
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
    rejectReason: row.rejectReason,
    takedownReason: row.takedownReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    owner: publicOwner(row),
  };
}

const ADMIN_REQUEST_QUERY = `
  SELECT r.id, r.ownerId, r.type, r.title, r.description, r.details,
         r.city, r.remote, r.industry, r.budgetOrReward, r.expiresAt, r.status,
         r.rejectReason, r.takedownReason, r.createdAt, r.updatedAt,
         u.nickname AS ownerNickname, u.city AS ownerCity,
         p.server AS ownerServer, p.gameNickname AS ownerGameNickname,
         p.sect AS ownerSect, p.startedYear AS ownerStartedYear,
         p.industry AS ownerIndustry, p.occupation AS ownerOccupation,
         COALESCE(v.status, 'not_submitted') AS ownerVerificationStatus
  FROM requests r
  JOIN users u ON u.id = r.ownerId
  LEFT JOIN profiles p ON p.userId = u.id
  LEFT JOIN verifications v ON v.userId = u.id
`;

function loadReviewedRequest(db, id) {
  return db.prepare(`${ADMIN_REQUEST_QUERY} WHERE r.id = ?`).get(id);
}

function loadReviewedRequestWithImages(db, id) {
  const row = loadReviewedRequest(db, id);
  if (!row) return null;
  return {
    ...row,
    images: loadImagesForRequests(db, [row.id]).get(row.id) ?? [],
  };
}

function verificationDto(row) {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    supportMaterial: row.supportMaterial,
    contactValue: row.contactValue,
    reviewerId: row.reviewerId,
    reviewedAt: row.reviewedAt,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    user: {
      id: row.userId,
      account: row.account,
      nickname: row.nickname,
      city: row.city,
      role: row.role,
      status: row.userStatus,
    },
    profile: {
      server: row.server,
      gameNickname: row.gameNickname,
      sect: row.sect,
      startedYear: row.startedYear,
      industry: row.industry,
      occupation: row.occupation,
      canOffer: row.canOffer,
      lookingFor: row.lookingFor,
    },
  };
}

const VERIFICATION_QUERY = `
  SELECT v.id, v.userId, v.status, v.supportMaterial, v.reviewerId,
         v.reviewedAt, v.rejectReason, v.createdAt, v.updatedAt,
         u.account, u.nickname, u.city, u.contactValue, u.role,
         u.status AS userStatus,
         p.server, p.gameNickname, p.sect, p.startedYear, p.industry,
         p.occupation, p.canOffer, p.lookingFor
  FROM verifications v
  JOIN users u ON u.id = v.userId
  LEFT JOIN profiles p ON p.userId = u.id
`;

const REPORT_STATUSES = ['pending', 'resolved', 'dismissed'];

const ADMIN_REPORT_QUERY = `
  SELECT report.id AS reportId, report.reporterId, report.targetType, report.targetId,
         report.reason, report.status, report.handlerId, report.handledAt,
         report.resultNote, report.createdAt,
         reporter.id AS reporterUserId, reporter.nickname AS reporterNickname,
         handler.id AS handlerUserId, handler.nickname AS handlerNickname,
         r.id, r.ownerId, r.type, r.title, r.description, r.details,
         r.city, r.remote, r.industry, r.budgetOrReward, r.expiresAt, r.status AS requestStatus,
         r.rejectReason, r.takedownReason, r.createdAt AS requestCreatedAt,
         r.updatedAt AS requestUpdatedAt, u.nickname AS ownerNickname, u.city AS ownerCity,
         p.server AS ownerServer, p.gameNickname AS ownerGameNickname,
         p.sect AS ownerSect, p.startedYear AS ownerStartedYear,
         p.industry AS ownerIndustry, p.occupation AS ownerOccupation,
         COALESCE(v.status, 'not_submitted') AS ownerVerificationStatus
  FROM reports report
  JOIN requests r ON r.id = report.targetId
  JOIN users reporter ON reporter.id = report.reporterId
  LEFT JOIN users handler ON handler.id = report.handlerId
  JOIN users u ON u.id = r.ownerId
  LEFT JOIN profiles p ON p.userId = u.id
  LEFT JOIN verifications v ON v.userId = u.id
  WHERE report.targetType = 'request'
`;

function reportDto(row) {
  return {
    id: row.reportId,
    reporterId: row.reporterId,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    status: row.status,
    handlerId: row.handlerId,
    handledAt: row.handledAt,
    resultNote: row.resultNote,
    createdAt: row.createdAt,
    reporter: {
      id: row.reporterUserId,
      nickname: row.reporterNickname,
    },
    handler: row.handlerUserId === null
      ? null
      : {
        id: row.handlerUserId,
        nickname: row.handlerNickname,
      },
    request: reviewedRequestDto({
      ...row,
      status: row.requestStatus,
      createdAt: row.requestCreatedAt,
      updatedAt: row.requestUpdatedAt,
    }),
  };
}

function loadRequestReportWithImages(db, reportId) {
  const row = db
    .prepare(`${ADMIN_REPORT_QUERY} AND report.id = ?`)
    .get(reportId);
  if (!row) return null;
  return reportDto({
    ...row,
    images: loadImagesForRequests(db, [row.id]).get(row.id) ?? [],
  });
}

function loadVerification(db, userId) {
  return db.prepare(`${VERIFICATION_QUERY} WHERE v.userId = ?`).get(userId);
}

export function createAdminRouter(db) {
  const router = Router();
  router.use(requireUser(db));
  router.use((req, res, next) => {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Administrator access required' });
    }
    return next();
  });

  router.get('/verifications', (req, res, next) => {
    try {
      const values = [];
      let where = '';
      if (req.query.status !== undefined) {
        if (!VERIFICATION_STATUSES.includes(req.query.status)) {
          throw clientError(400, 'Invalid verification status');
        }
        where = ' WHERE v.status = ?';
        values.push(req.query.status);
      }
      const rows = db
        .prepare(`${VERIFICATION_QUERY}${where} ORDER BY v.id DESC`)
        .all(...values);
      return res.json({
        verifications: rows.map((row) => verificationDto(row)),
      });
    } catch (error) {
      return next(error);
    }
  });

  function reviewVerification(status) {
    return (req, res, next) => {
      try {
        const userId = positiveId(req.params.userId);
        const reason =
          status === 'rejected'
            ? requiredText(req.body?.reason, 'reason')
            : null;
        const existing = loadVerification(db, userId);
        if (!existing) {
          return res.status(404).json({ error: 'Verification not found' });
        }
        const update = db
          .prepare(
            `UPDATE verifications
             SET status = ?, reviewerId = ?, reviewedAt = CURRENT_TIMESTAMP,
                 rejectReason = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE userId = ? AND status = 'pending'`,
          )
          .run(status, req.user.id, reason, userId);
        if (update.changes === 0) {
          return res.status(409).json({
            error: 'Verification cannot be reviewed in its current state',
          });
        }
        return res.json({ verification: verificationDto(loadVerification(db, userId)) });
      } catch (error) {
        return next(error);
      }
    };
  }

  router.post('/verifications/:userId/approve', reviewVerification('approved'));
  router.post('/verifications/:userId/reject', reviewVerification('rejected'));

  router.get('/reports', (req, res, next) => {
    try {
      const values = [];
      let statusFilter = '';
      if (req.query.status !== undefined) {
        if (!REPORT_STATUSES.includes(req.query.status)) {
          throw clientError(400, 'Invalid report status');
        }
        statusFilter = ' AND report.status = ?';
        values.push(req.query.status);
      }
      const rows = db
        .prepare(`${ADMIN_REPORT_QUERY}${statusFilter} ORDER BY report.createdAt DESC, report.id DESC`)
        .all(...values);
      const imagesByRequestId = loadImagesForRequests(
        db,
        rows.map((row) => row.id),
      );
      return res.json({
        reports: rows.map((row) => reportDto({
          ...row,
          images: imagesByRequestId.get(row.id) ?? [],
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  function handleRequestReport(action) {
    return (req, res, next) => {
      try {
        const reportId = positiveId(req.params.id);
        const resultNote = requiredText(req.body?.resultNote, 'resultNote');
        const report = loadRequestReportWithImages(db, reportId);
        if (!report) {
          return res.status(404).json({ error: 'Request report not found' });
        }

        if (action === 'dismiss') {
          const update = db.prepare(
            `UPDATE reports
             SET status = 'dismissed', handlerId = ?, handledAt = CURRENT_TIMESTAMP,
                 resultNote = ?
             WHERE id = ? AND targetType = 'request' AND status = 'pending'`,
          ).run(req.user.id, resultNote, reportId);
          if (update.changes === 0) {
            return res.status(409).json({ error: 'Report cannot be handled in its current state' });
          }
          return res.json({ report: loadRequestReportWithImages(db, reportId) });
        }

        db.transaction(() => {
          const requestUpdate = db.prepare(
            `UPDATE requests
             SET status = 'taken_down', takedownReason = ?, updatedAt = CURRENT_TIMESTAMP
             WHERE id = ? AND status = 'approved'`,
          ).run(resultNote, report.targetId);
          if (requestUpdate.changes === 0) {
            throw clientError(409, 'Request cannot be taken down in its current state');
          }
          const reportUpdate = db.prepare(
            `UPDATE reports
             SET status = 'resolved', handlerId = ?, handledAt = CURRENT_TIMESTAMP,
                 resultNote = ?
             WHERE id = ? AND targetType = 'request' AND status = 'pending'`,
          ).run(req.user.id, resultNote, reportId);
          if (reportUpdate.changes === 0) {
            throw clientError(409, 'Report cannot be handled in its current state');
          }
        })();

        return res.json({
          report: loadRequestReportWithImages(db, reportId),
          request: reviewedRequestDto(loadReviewedRequestWithImages(db, report.targetId)),
        });
      } catch (error) {
        return next(error);
      }
    };
  }

  router.post('/reports/:id/dismiss', handleRequestReport('dismiss'));
  router.post('/reports/:id/takedown', handleRequestReport('takedown'));

  router.get('/requests', (req, res, next) => {
    try {
      const clauses = [];
      const values = [];
      if (req.query.status !== undefined) {
        if (!REQUEST_STATUSES.includes(req.query.status)) {
          throw clientError(400, 'Invalid request status');
        }
        clauses.push('r.status = ?');
        values.push(req.query.status);
      }
      if (req.query.type !== undefined) {
        if (!Object.hasOwn(REQUEST_TYPES, req.query.type)) {
          throw clientError(400, 'Invalid request type');
        }
        clauses.push('r.type = ?');
        values.push(req.query.type);
      }
      if (req.query.city !== undefined) {
        const city = requiredText(req.query.city, 'city', 80);
        clauses.push('r.city = ?');
        values.push(city);
      }
      if (req.query.industry !== undefined) {
        const industry = requiredText(req.query.industry, 'industry', 120);
        clauses.push('r.industry = ?');
        values.push(industry);
      }
      if (req.query.expired !== undefined) {
        if (!['true', 'false'].includes(req.query.expired)) {
          throw clientError(400, 'expired must be true or false');
        }
        clauses.push("(datetime(r.expiresAt) <= datetime('now')) = ?");
        values.push(req.query.expired === 'true' ? 1 : 0);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const rows = db
        .prepare(`${ADMIN_REQUEST_QUERY}${where} ORDER BY r.id DESC`)
        .all(...values);
      const imagesByRequestId = loadImagesForRequests(
        db,
        rows.map((row) => row.id),
      );
      return res.json({
        requests: rows.map((row) =>
          reviewedRequestDto({
            ...row,
            images: imagesByRequestId.get(row.id) ?? [],
          }),
        ),
      });
    } catch (error) {
      return next(error);
    }
  });

  function transitionRequest(fromStatus, toStatus, reasonField) {
    return (req, res, next) => {
      try {
        const id = positiveId(req.params.id);
        const reason = reasonField
          ? requiredText(req.body?.reason, 'reason')
          : null;
        const existing = loadReviewedRequest(db, id);
        if (!existing) return res.status(404).json({ error: 'Request not found' });
        const assignments = [`status = ?`, 'updatedAt = CURRENT_TIMESTAMP'];
        const values = [toStatus];
        if (reasonField) {
          assignments.push(`${reasonField} = ?`);
          values.push(reason);
        }
        values.push(id, fromStatus);
        const approvalCondition =
          toStatus === 'approved'
            ? `AND datetime(expiresAt) > datetime('now')
               AND EXISTS (
                 SELECT 1 FROM users owner
                 WHERE owner.id = requests.ownerId
                   AND owner.status = 'active'
               )
               AND EXISTS (
                 SELECT 1 FROM verifications ownerVerification
                 WHERE ownerVerification.userId = requests.ownerId
                   AND ownerVerification.status = 'approved'
               )`
            : '';
        const update = db
          .prepare(
            `UPDATE requests SET ${assignments.join(', ')}
             WHERE id = ? AND status = ?
             ${approvalCondition}`,
          )
          .run(...values);
        if (update.changes === 0) {
          return res.status(409).json({
            error: 'Request cannot be reviewed in its current state',
          });
        }
        return res.json({
          request: reviewedRequestDto(loadReviewedRequestWithImages(db, id)),
        });
      } catch (error) {
        return next(error);
      }
    };
  }

  router.post(
    '/requests/:id/approve',
    transitionRequest('pending', 'approved', null),
  );
  router.post(
    '/requests/:id/reject',
    transitionRequest('pending', 'rejected', 'rejectReason'),
  );
  router.post(
    '/requests/:id/takedown',
    transitionRequest('approved', 'taken_down', 'takedownReason'),
  );

  router.delete('/requests/:id', (req, res, next) => {
    try {
      const id = positiveId(req.params.id);
      const existing = db.prepare('SELECT id FROM requests WHERE id = ?').get(id);
      if (!existing) {
        return res.status(404).json({ error: 'Request not found' });
      }
      deleteRequestImageFiles(db, id);
      db.transaction((requestId) => {
        db.prepare("DELETE FROM reports WHERE targetType = 'request' AND targetId = ?").run(requestId);
        db.prepare('DELETE FROM requests WHERE id = ?').run(requestId);
      })(id);
      return res.json({ deleted: true });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/users', (req, res, next) => {
    try {
      const clauses = [];
      const values = [];
      for (const [queryField, sqlField] of [
        ['nickname', 'u.nickname'],
        ['server', 'p.server'],
        ['city', 'u.city'],
        ['industry', 'p.industry'],
      ]) {
        if (req.query[queryField] !== undefined) {
          const value = requiredText(req.query[queryField], queryField, 120);
          clauses.push(`${sqlField} LIKE ?`);
          values.push(`%${value}%`);
        }
      }
      if (req.query.verificationStatus !== undefined) {
        if (!VERIFICATION_STATUSES.includes(req.query.verificationStatus)) {
          throw clientError(400, 'Invalid verification status');
        }
        clauses.push("COALESCE(v.status, 'not_submitted') = ?");
        values.push(req.query.verificationStatus);
      }
      if (req.query.status !== undefined) {
        if (!['active', 'disabled'].includes(req.query.status)) {
          throw clientError(400, 'Invalid user status');
        }
        clauses.push('u.status = ?');
        values.push(req.query.status);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const rows = db
        .prepare(
          `SELECT u.id, u.nickname, u.city, u.role, u.status, u.createdAt,
                  u.updatedAt, COALESCE(v.status, 'not_submitted') AS verificationStatus,
                  p.server, p.gameNickname, p.sect, p.startedYear, p.industry,
                  p.occupation, p.canOffer, p.lookingFor
           FROM users u
           LEFT JOIN profiles p ON p.userId = u.id
           LEFT JOIN verifications v ON v.userId = u.id
           ${where}
           ORDER BY u.id DESC`,
        )
        .all(...values);
      return res.json({ users: rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/users/:id/disable', (req, res, next) => {
    try {
      const id = positiveId(req.params.id);
      if (id === req.user.id) {
        return res.status(409).json({ error: 'Administrators cannot disable themselves' });
      }
      const existing = db
        .prepare('SELECT id, nickname, city, role, status FROM users WHERE id = ?')
        .get(id);
      if (!existing) return res.status(404).json({ error: 'User not found' });
      if (existing.role === 'admin') {
        return res.status(409).json({ error: 'Administrators cannot disable other administrators' });
      }
      const update = db
        .prepare(
          `UPDATE users SET status = 'disabled', updatedAt = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'active'`,
        )
        .run(id);
      if (update.changes === 0) {
        return res.status(409).json({ error: 'User is already disabled' });
      }
      const user = db
        .prepare('SELECT id, nickname, city, role, status FROM users WHERE id = ?')
        .get(id);
      return res.json({ user });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createAdminRouter;
