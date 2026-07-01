import cors from 'cors';
import express from 'express';

import { createAuthRouter } from './routes/auth.js';
import { createProfileRouter } from './routes/profile.js';

export function createApp(db) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/profile', createProfileRouter(db));

  app.use((error, _req, res, _next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    const message = status < 500 ? error.message : 'Internal server error';
    res.status(status).json({ error: message });
  });

  return app;
}

export default createApp;
