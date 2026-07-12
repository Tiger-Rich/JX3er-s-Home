import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { rmSync } from 'node:fs';

import {
  REQUEST_IMAGE_DIRECTORY,
  REQUEST_IMAGE_ROUTE,
} from './requestImages.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter } from './routes/auth.js';
import { createContactRouter } from './routes/contact.js';
import { createProfileRouter } from './routes/profile.js';
import { createRequestsRouter } from './routes/requests.js';

function removeUploadedFiles(files) {
  for (const file of files ?? []) {
    if (file?.path) rmSync(file.path, { force: true });
  }
}

export function createApp(db) {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(REQUEST_IMAGE_ROUTE, express.static(REQUEST_IMAGE_DIRECTORY));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/profile', createProfileRouter(db));
  app.use('/api/requests', createRequestsRouter(db));
  app.use('/api/contact', createContactRouter(db));
  app.use('/api/admin', createAdminRouter(db));

  app.use((error, req, res, _next) => {
    if (error?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large' });
    }
    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    if (error instanceof multer.MulterError) {
      removeUploadedFiles(req.files);
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: 'Each image must be at most 5MB',
        });
      }
      if (
        error.code === 'LIMIT_FILE_COUNT' ||
        error.code === 'LIMIT_UNEXPECTED_FILE'
      ) {
        return res.status(400).json({
          error: 'A trade request can include at most 6 images',
        });
      }
    }
    if (error?.exposeToClient === true && Number.isInteger(error.status)) {
      removeUploadedFiles(req.files);
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export default createApp;
