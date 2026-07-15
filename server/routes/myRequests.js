import { Router } from 'express';

import { requireUser } from '../auth.js';
import { canPublishRequest, REQUEST_STATUSES } from '../domain.js';
import { buildRequestValuesFromBody } from '../requestPayload.js';
import { parseRequestDetails } from '../requestDetails.js';
import { loadImagesForRequests } from '../requestImages.js';

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

function requirePublishEligibility(req, res, next) {
  if (!canPublishRequest(req.user)) {
    return res.status(403).json({ error: 'Approved verification required' });
  }
  return next();
}

const MY_REQUEST_QUERY = `
  SELECT r.id, r.ownerId, r.type, r.title, r.description, r.details,
         r.city, r.remote, r.industry, r.budgetOrReward, r.expiresAt, r.status,
         r.rejectReason, r.takedownReason, r.withdrawnAt, r.closedAt,
         r.ownerHiddenAt, r.createdAt, r.updatedAt,
         COALESCE(rr.reactionCount, 0) AS reactionCount,
         COALESCE(fr.favoriteCount, 0) AS favoriteCount,
         COALESCE(ca.applicationCount, 0) AS applicationCount
  FROM requests r
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
`;

function loadOwnedRequest(db, id, ownerId) {
  return db.prepare(`${MY_REQUEST_QUERY} WHERE r.id = ? AND r.ownerId = ?`).get(id, ownerId);
}

function requestDto(row) {
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
    withdrawnAt: row.withdrawnAt,
    closedAt: row.closedAt,
    ownerHiddenAt: row.ownerHiddenAt,
    favoriteCount: Number(row.favoriteCount ?? 0),
    reactionCount: Number(row.reactionCount ?? 0),
    applicationCount: Number(row.applicationCount ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function withImages(db, row) {
  if (!row) return null;
  return {
    ...row,
    images: loadImagesForRequests(db, [row.id]).get(row.id) ?? [],
  };
}

export function createMyRequestsRouter(db) {
  const router = Router();
  router.use(requireUser(db));

  router.get('/', (req, res, next) => {
    try {
      const clauses = ['r.ownerId = ?', 'r.ownerHiddenAt IS NULL'];
      const values = [req.user.id];
      if (req.query.status !== undefined) {
        if (!REQUEST_STATUSES.includes(req.query.status)) {
          throw clientError(400, 'Invalid request status');
        }
        clauses.push('r.status = ?');
        values.push(req.query.status);
      }
      const rows = db
        .prepare(`${MY_REQUEST_QUERY} WHERE ${clauses.join(' AND ')} ORDER BY r.id DESC`)
        .all(...values);
      const imagesByRequestId = loadImagesForRequests(db, rows.map((row) => row.id));
      return res.json({
        requests: rows.map((row) => requestDto({
          ...row,
          images: imagesByRequestId.get(row.id) ?? [],
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const row = loadOwnedRequest(db, positiveId(req.params.id), req.user.id);
      if (!row) return res.status(404).json({ error: 'Request not found' });
      return res.json({ request: requestDto(withImages(db, row)) });
    } catch (error) {
      return next(error);
    }
  });

  function transition({ fromStatus, statement, error, success }) {
    return (req, res, next) => {
      try {
        const id = positiveId(req.params.id);
        if (!loadOwnedRequest(db, id, req.user.id)) {
          return res.status(404).json({ error: 'Request not found' });
        }
        const result = db.prepare(statement).run(id, req.user.id, fromStatus);
        if (result.changes === 0) return res.status(409).json({ error });
        const updated = loadOwnedRequest(db, id, req.user.id);
        return res.json(success(requestDto(withImages(db, updated))));
      } catch (caught) {
        return next(caught);
      }
    };
  }

  router.post('/:id/withdraw', transition({
    fromStatus: 'pending',
    error: 'Request cannot be withdrawn in its current state',
    success: (request) => ({ request }),
    statement: `
      UPDATE requests
      SET status = 'withdrawn', withdrawnAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
      WHERE id = ? AND ownerId = ? AND status = ?
    `,
  }));
  router.post('/:id/close', transition({
    fromStatus: 'approved',
    error: 'Request cannot be closed in its current state',
    success: (request) => ({ request }),
    statement: `
      UPDATE requests
      SET status = 'closed', closedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
      WHERE id = ? AND ownerId = ? AND status = ?
    `,
  }));
  router.post('/:id/hide', transition({
    fromStatus: 'closed',
    error: 'Request cannot be hidden in its current state',
    success: () => ({ hidden: true }),
    statement: `
      UPDATE requests
      SET ownerHiddenAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
      WHERE id = ? AND ownerId = ? AND status = ?
    `,
  }));

  router.put('/:id', requirePublishEligibility, (req, res, next) => {
    try {
      const id = positiveId(req.params.id);
      const ownedRequest = loadOwnedRequest(db, id, req.user.id);
      if (!ownedRequest) {
        return res.status(404).json({ error: 'Request not found' });
      }
      const values = buildRequestValuesFromBody(req.user.id, req.body ?? {});
      const oldImages = loadImagesForRequests(db, [id]).get(id) ?? [];
      if (ownedRequest.status === 'withdrawn' && oldImages.length > 0 && values.type !== 'trade') {
        throw clientError(400, 'Requests with images can only be resubmitted as trade requests');
      }
      const result = db.prepare(`
        UPDATE requests
        SET type = @type, title = @title, description = @description, details = @details,
            city = @city, remote = @remote, industry = @industry,
            budgetOrReward = @budgetOrReward, expiresAt = @expiresAt,
            status = 'pending', rejectReason = NULL, withdrawnAt = NULL,
            closedAt = NULL, ownerHiddenAt = NULL, updatedAt = CURRENT_TIMESTAMP
        WHERE id = @id AND ownerId = @ownerId AND status = 'withdrawn'
      `).run({ ...values, id });
      if (result.changes === 0) {
        return res.status(409).json({ error: 'Request cannot be resubmitted in its current state' });
      }
      return res.json({ request: requestDto(withImages(db, loadOwnedRequest(db, id, req.user.id))) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createMyRequestsRouter;
