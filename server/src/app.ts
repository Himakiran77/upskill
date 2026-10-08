import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z, ZodError } from 'zod';
import { isClockPinned, now, repoRoot } from './config.js';
import type { Db } from './db.js';
import {
  createStudent,
  enroll,
  findViewer,
  getRoster,
  getStudent,
  HttpError,
  listSkills,
  logLesson,
  removeStudent,
  renameStudent,
  setGoals,
  type Viewer,
} from './service.js';

const enrollBody = z.object({ courseId: z.string().min(1) });
const goalsBody = z.object({ skillIds: z.array(z.string().min(1)).max(20) });
// Trimmed and collapsed, so "  Asha   Rao " is stored as "Asha Rao".
const personName = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1).max(80));
const newStudentBody = z.object({ name: personName, skillIds: z.array(z.string().min(1)).max(20).default([]) });
const renameBody = z.object({ name: personName });

type Handler = (req: Request, res: Response, viewer: Viewer) => Promise<void>;

export function createApp(db: Db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  /**
   * Auth stub. The coach comes from X-Coach-Id, or DEFAULT_COACH_ID when the
   * header is absent. Swap this one function for real sessions; everything
   * downstream already takes the viewer and scopes to their center.
   */
  const withViewer =
    (handler: Handler): RequestHandler =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const coachId = req.header('x-coach-id') ?? process.env.DEFAULT_COACH_ID;
        const viewer = coachId ? await findViewer(db, coachId) : null;
        if (!viewer) throw new HttpError(401, 'unknown_coach', 'Sign in as a coach to continue.');
        await handler(req, res, viewer);
      } catch (error) {
        next(error);
      }
    };

  app.get(
    '/api/session',
    withViewer(async (_req, res, viewer) => {
      res.json({
        coach: { id: viewer.coachId, name: viewer.coachName },
        center: { id: viewer.centerId, name: viewer.centerName, timeZone: viewer.timeZone },
        asOf: now().toISOString(),
        clockPinned: isClockPinned(),
        skills: await listSkills(db, viewer),
      });
    }),
  );

  app.get(
    '/api/students',
    withViewer(async (_req, res, viewer) => {
      res.json({ students: await getRoster(db, viewer) });
    }),
  );

  app.post(
    '/api/students',
    withViewer(async (req, res, viewer) => {
      res.status(201).json({ student: await createStudent(db, viewer, newStudentBody.parse(req.body)) });
    }),
  );

  app.get(
    '/api/students/:studentId',
    withViewer(async (req, res, viewer) => {
      res.json({ student: await getStudent(db, viewer, req.params.studentId!) });
    }),
  );

  app.patch(
    '/api/students/:studentId',
    withViewer(async (req, res, viewer) => {
      const { name } = renameBody.parse(req.body);
      res.json({ student: await renameStudent(db, viewer, req.params.studentId!, name) });
    }),
  );

  app.delete(
    '/api/students/:studentId',
    withViewer(async (req, res, viewer) => {
      await removeStudent(db, viewer, req.params.studentId!);
      res.status(204).end();
    }),
  );

  app.post(
    '/api/students/:studentId/enrollments',
    withViewer(async (req, res, viewer) => {
      const { courseId } = enrollBody.parse(req.body);
      res.status(201).json({ student: await enroll(db, viewer, req.params.studentId!, courseId) });
    }),
  );

  app.post(
    '/api/students/:studentId/enrollments/:courseId/lessons',
    withViewer(async (req, res, viewer) => {
      res.status(201).json({
        student: await logLesson(db, viewer, req.params.studentId!, req.params.courseId!),
      });
    }),
  );

  app.put(
    '/api/students/:studentId/goals',
    withViewer(async (req, res, viewer) => {
      const { skillIds } = goalsBody.parse(req.body);
      res.json({ student: await setGoals(db, viewer, req.params.studentId!, skillIds) });
    }),
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint.' } });
  });

  // After `npm run build`, the API also serves the React app on the same port.
  const clientDist = path.join(repoRoot, 'client', 'dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'The request body is not valid.' } });
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: { code: 'invalid_json', message: 'The request body is not valid JSON.' } });
      return;
    }
    // Two requests enrolling the same learner in the same course at once.
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505') {
      res.status(409).json({ error: { code: 'conflict', message: 'That was already saved. Refresh to see it.' } });
      return;
    }
    console.error(error);
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on the server.' } });
  });

  return app;
}
