import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createApp } from './app.js';
import { createDatabase, seedDatabase } from './db.js';

function shouldResetDatabase(reset) {
  return reset === true || reset === '1' || reset === 'true';
}

function readPort(port) {
  if (!port) return undefined;
  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    throw new Error(`Invalid FANSHU_PORT: ${port}`);
  }
  return parsedPort;
}

export function readServerOptionsFromEnv(env = process.env) {
  return {
    filename: env.FANSHU_DB_FILENAME,
    host: env.FANSHU_HOST,
    port: readPort(env.FANSHU_PORT),
    resetDatabase: shouldResetDatabase(env.FANSHU_DB_RESET),
  };
}

export function startServer({
  filename = readServerOptionsFromEnv().filename ?? join(process.cwd(), 'fanshu.db'),
  host = readServerOptionsFromEnv().host ?? '127.0.0.1',
  port = readServerOptionsFromEnv().port ?? 8787,
  resetDatabase = readServerOptionsFromEnv().resetDatabase,
} = {}) {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
    if (resetDatabase && existsSync(filename)) {
      rmSync(filename);
    }
  }

  const db = createDatabase(filename);
  try {
    seedDatabase(db);
    let databaseClosed = false;
    const closeDatabase = () => {
      if (databaseClosed) return;
      databaseClosed = true;
      if (db.open) db.close();
    };
    const server = createApp(db).listen(port, host, (error) => {
      if (error) return;
      console.log(`Fanshu API listening on http://${host}:${port}`);
    });
    server.once('error', closeDatabase);
    server.once('close', closeDatabase);
    return server;
  } catch (error) {
    if (db.open) db.close();
    throw error;
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const server = startServer();
    server.on('error', (error) => {
      console.error(`Failed to start Fanshu API: ${error.message}`);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(`Failed to start Fanshu API: ${error.message}`);
    process.exitCode = 1;
  }
}
