import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createApp } from './app.js';
import { createDatabase, seedDatabase } from './db.js';

export function startServer({
  filename = join(process.cwd(), 'fanshu.db'),
  host = '127.0.0.1',
  port = 8787,
} = {}) {
  const db = createDatabase(filename);
  try {
    seedDatabase(db);
    const server = createApp(db).listen(port, host, () => {
      console.log(`Fanshu API listening on http://${host}:${port}`);
    });
    server.on('close', () => {
      if (db.open) db.close();
    });
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
