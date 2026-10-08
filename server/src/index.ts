import { createApp } from './app.js';
import { databaseUrl } from './config.js';
import { createPool } from './db.js';

const db = createPool(databaseUrl());
const port = Number(process.env.PORT ?? 4000);

const server = createApp(db).listen(port, () => {
  console.log(`Upskill API listening on http://localhost:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void db.end().then(() => process.exit(0));
    });
  });
}
