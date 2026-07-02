import { Router } from 'express';

import { requireUser } from '../auth.js';
import { canSeeContact } from '../domain.js';

const APPLICATION_QUERY = `
  SELECT a.id, a.requestId, a.applicantId, a.ownerId, a.message, a.status,
         a.handledAt, a.createdAt, a.updatedAt, r.title AS requestTitle,
         applicant.nickname AS applicantNickname,
         applicant.contactValue AS applicantContactValue,
         owner.nickname AS ownerNickname,
         owner.contactValue AS ownerContactValue
  FROM contact_applications a
  JOIN requests r ON r.id = a.requestId
  JOIN users applicant ON applicant.id = a.applicantId
  JOIN users owner ON owner.id = a.ownerId
`;

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

function applicationDto(row, user) {
  const isOwner = user.id === row.ownerId;
  const application = {
    id: row.id,
    requestId: row.requestId,
    applicantId: row.applicantId,
    ownerId: row.ownerId,
    message: row.message,
    status: row.status,
    handledAt: row.handledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    requestTitle: row.requestTitle,
    applicantNickname: row.applicantNickname,
    ownerNickname: row.ownerNickname,
    direction: isOwner ? 'incoming' : 'outgoing',
  };
  if (canSeeContact(user, row)) {
    application.contactValue = isOwner
      ? row.applicantContactValue
      : row.ownerContactValue;
  }
  return application;
}

function loadApplication(db, id) {
  return db.prepare(`${APPLICATION_QUERY} WHERE a.id = ?`).get(id);
}

export function createContactRouter(db) {
  const router = Router();
  router.use(requireUser(db));

  router.get('/', (req, res) => {
    const rows = db
      .prepare(
        `${APPLICATION_QUERY}
         WHERE a.ownerId = ? OR a.applicantId = ?
         ORDER BY datetime(a.createdAt) DESC, a.id DESC`,
      )
      .all(req.user.id, req.user.id);
    return res.json({
      applications: rows.map((row) => applicationDto(row, req.user)),
    });
  });

  router.get('/:id', (req, res, next) => {
    try {
      const row = loadApplication(db, positiveId(req.params.id));
      if (!row) return res.status(404).json({ error: 'Application not found' });
      if (req.user.id !== row.ownerId && req.user.id !== row.applicantId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      return res.json({ application: applicationDto(row, req.user) });
    } catch (error) {
      return next(error);
    }
  });

  function transition(status) {
    return (req, res, next) => {
      try {
        const id = positiveId(req.params.id);
        const existing = loadApplication(db, id);
        if (!existing) {
          return res.status(404).json({ error: 'Application not found' });
        }
        if (existing.ownerId !== req.user.id) {
          return res.status(403).json({ error: 'Only the request owner may respond' });
        }
        const update = db
          .prepare(
            `UPDATE contact_applications
             SET status = ?, handledAt = CURRENT_TIMESTAMP,
                 updatedAt = CURRENT_TIMESTAMP
             WHERE id = ? AND status = 'pending'`,
          )
          .run(status, id);
        if (update.changes === 0) {
          return res.status(409).json({
            error: 'Application cannot be changed in its current state',
          });
        }
        return res.json({
          application: applicationDto(loadApplication(db, id), req.user),
        });
      } catch (error) {
        return next(error);
      }
    };
  }

  router.post('/:id/approve', transition('approved'));
  router.post('/:id/reject', transition('rejected'));

  return router;
}

export default createContactRouter;
