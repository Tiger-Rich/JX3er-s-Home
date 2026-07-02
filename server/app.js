import cors from 'cors';
import express from 'express';

import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter } from './routes/auth.js';
import { createContactRouter } from './routes/contact.js';
import { createProfileRouter } from './routes/profile.js';
import { createRequestsRouter } from './routes/requests.js';

export function createApp(db) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/profile', createProfileRouter(db));
  app.use('/api/requests', createRequestsRouter(db));
  app.use('/api/contact', createContactRouter(db));
  app.use('/api/admin', createAdminRouter(db));

  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large' });
    }
    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    if (error?.exposeToClient === true && Number.isInteger(error.status)) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export default createApp;
