import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { databaseUrl, serverRoot } from './config.js';
import { createPool, transaction, type Db } from './db.js';

const migrationsDir = path.join(serverRoot, 'db', 'migrations');

/** Apply every .sql file in db/migrations that has not run yet, in name order. */
export async function migrate(db: Db): Promise<string[]> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const done = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    await transaction(db, async (tx) => {
      await tx.query(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = createPool(databaseUrl());
  try {
    const applied = await migrate(db);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Schema is up to date.');
  } finally {
    await db.end();
  }
}
