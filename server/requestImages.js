import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import multer from 'multer';

export const REQUEST_IMAGE_ROUTE = '/uploads/request-images';
export const REQUEST_IMAGE_DIRECTORY = path.resolve(
  process.cwd(),
  'uploads',
  'request-images',
);
export const MAX_TRADE_IMAGES = 6;
export const MAX_TRADE_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const initializedDatabases = new WeakSet();

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.exposeToClient = true;
  return error;
}

function ensureRequestImagesTable(db) {
  if (initializedDatabases.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS request_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requestId INTEGER NOT NULL,
      url TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      sizeBytes INTEGER NOT NULL,
      sortOrder INTEGER NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (requestId) REFERENCES requests(id) ON DELETE CASCADE
    )
  `);
  initializedDatabases.add(db);
}

const storage = multer.diskStorage({
  destination(_req, _file, callback) {
    fs.mkdirSync(REQUEST_IMAGE_DIRECTORY, { recursive: true });
    callback(null, REQUEST_IMAGE_DIRECTORY);
  },
  filename(_req, file, callback) {
    callback(null, `${crypto.randomUUID()}${MIME_EXTENSIONS.get(file.mimetype)}`);
  },
});

export const requestImageUpload = multer({
  storage,
  limits: {
    fileSize: MAX_TRADE_IMAGE_BYTES,
    files: MAX_TRADE_IMAGES,
  },
  fileFilter(_req, file, callback) {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      return callback(
        clientError(400, 'images must be JPG, PNG, or WebP files'),
      );
    }
    return callback(null, true);
  },
}).array('images', MAX_TRADE_IMAGES);

export function requestImageDto(row) {
  return {
    id: row.id,
    requestId: row.requestId,
    url: row.url,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}

export function insertRequestImages(db, requestId, files) {
  ensureRequestImagesTable(db);
  if (!files?.length) return [];
  const insert = db.prepare(
    `INSERT INTO request_images (requestId, url, mimeType, sizeBytes, sortOrder)
     VALUES (?, ?, ?, ?, ?)`,
  );
  files.forEach((file, index) => {
    insert.run(
      requestId,
      `${REQUEST_IMAGE_ROUTE}/${file.filename}`,
      file.mimetype,
      file.size,
      index,
    );
  });
  return loadImagesForRequests(db, [requestId]).get(requestId) ?? [];
}

export function loadImagesForRequests(db, requestIds) {
  ensureRequestImagesTable(db);
  const uniqueIds = [...new Set(requestIds)].filter((id) => Number.isInteger(id));
  const imagesByRequestId = new Map(uniqueIds.map((id) => [id, []]));
  if (uniqueIds.length === 0) return imagesByRequestId;

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, requestId, url, mimeType, sizeBytes, sortOrder, createdAt
       FROM request_images
       WHERE requestId IN (${placeholders})
       ORDER BY requestId, sortOrder, id`,
    )
    .all(...uniqueIds);
  for (const row of rows) {
    imagesByRequestId.get(row.requestId)?.push(requestImageDto(row));
  }
  return imagesByRequestId;
}
