/**
 * Move a learner to another center.
 *
 *   npm run move-learner -- <studentId> <centerId>
 *
 * A command rather than an endpoint on purpose: moving people between
 * centers is an org-admin action, and there is no admin role to guard an
 * endpoint with yet.
 */
import { databaseUrl } from '../config.js';
import { createPool } from '../db.js';
import { moveLearner } from '../service.js';

const [studentId, centerId] = process.argv.slice(2);
if (!studentId || !centerId) {
  console.error('Usage: npm run move-learner -- <studentId> <centerId>');
  process.exit(1);
}

const db = createPool(databaseUrl());
try {
  const { from, to } = await moveLearner(db, studentId, centerId);
  console.log(`Moved ${studentId} from ${from} to ${to}. Progress and goals moved with them.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.end();
}
