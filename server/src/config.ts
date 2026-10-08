import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

/** server/ — the same from src/ (tsx) and dist/ (node). */
export const serverRoot = path.resolve(here, '..');
export const repoRoot = path.resolve(serverRoot, '..');

dotenv.config({ path: path.join(repoRoot, '.env') });

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
  return url;
}

/**
 * The single source of "now". AS_OF pins it so the fixed-date seed can be
 * demoed on any day; without AS_OF this is the real clock.
 */
export function now(): Date {
  const pinned = process.env.AS_OF;
  if (!pinned) return new Date();
  const date = new Date(pinned);
  if (Number.isNaN(date.getTime())) throw new Error(`AS_OF is not a valid date: ${pinned}`);
  return date;
}

export function isClockPinned(): boolean {
  return Boolean(process.env.AS_OF);
}
