import { randomUUID } from 'node:crypto';
import { now } from './config.js';
import { transaction, type Db, type Queryable } from './db.js';
import {
  ACTIVITY_WINDOW_DAYS,
  buildStudentView,
  compareForTriage,
  unmetPrerequisites,
  type Catalog,
  type Course,
  type Enrollment,
  type StudentFacts,
  type StudentView,
} from './rules.js';

/** An error the client caused and can act on. Anything else is a 500. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** The signed-in coach and the one center they can see. */
export interface Viewer {
  coachId: string;
  coachName: string;
  centerId: string;
  centerName: string;
  timeZone: string;
}

export type StudentSummary = Pick<
  StudentView,
  'id' | 'name' | 'status' | 'goals' | 'earnedSkills' | 'activeDays' | 'activity' | 'daysSinceActive' | 'atRiskCourses'
> & {
  coursesInProgress: number;
  /** Just enough of each course to draw its progress in the roster. */
  courses: Pick<StudentView['courses'][number], 'courseId' | 'title' | 'percent' | 'state'>[];
};

// --- Reads -----------------------------------------------------------------

export async function findViewer(db: Queryable, coachId: string): Promise<Viewer | null> {
  const { rows } = await db.query(
    `SELECT co.id AS coach_id, co.name AS coach_name, ce.id AS center_id, ce.name AS center_name, ce.timezone
       FROM coaches co JOIN centers ce ON ce.id = co.center_id
      WHERE co.id = $1`,
    [coachId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    coachId: row.coach_id,
    coachName: row.coach_name,
    centerId: row.center_id,
    centerName: row.center_name,
    timeZone: row.timezone,
  };
}

/** The shared catalog, with each course marked as offered at this center or not. */
async function loadCatalog(db: Queryable, centerId: string): Promise<Catalog> {
  const { rows } = await db.query(
    `SELECT c.id, c.title, c.total_lessons,
            COALESCE((SELECT array_agg(cs.skill_id ORDER BY cs.skill_id)
                        FROM course_skills cs WHERE cs.course_id = c.id), '{}'::text[]) AS skills,
            COALESCE((SELECT array_agg(cp.prerequisite_id ORDER BY cp.prerequisite_id)
                        FROM course_prerequisites cp WHERE cp.course_id = c.id), '{}'::text[]) AS prerequisites,
            EXISTS (SELECT 1 FROM center_courses cc
                     WHERE cc.course_id = c.id AND cc.center_id = $1) AS offered
       FROM courses c
      ORDER BY c.id`,
    [centerId],
  );
  return new Map(
    rows.map((r): [string, Course] => [
      r.id,
      {
        id: r.id,
        title: r.title,
        totalLessons: r.total_lessons,
        skills: r.skills,
        prerequisites: r.prerequisites,
        offered: r.offered,
      },
    ]),
  );
}

/**
 * Learners whose open membership is at this center. This join is the only
 * way the app reaches a learner, so a coach cannot read another center's
 * people by guessing ids. A learner's enrollments come along whole, wherever
 * they were taken, which is how progress survives a move.
 */
async function loadStudentFacts(db: Queryable, centerId: string, studentId?: string): Promise<StudentFacts[]> {
  const students = await db.query(
    `SELECT s.id, s.name,
            COALESCE((SELECT array_agg(g.skill_id ORDER BY g.skill_id)
                        FROM student_goals g WHERE g.student_id = s.id), '{}'::text[]) AS goals
       FROM students s
       JOIN center_memberships m ON m.student_id = s.id AND m.left_at IS NULL
      WHERE m.center_id = $1 AND ($2::text IS NULL OR s.id = $2)
      ORDER BY s.name`,
    [centerId, studentId ?? null],
  );
  if (students.rows.length === 0) return [];
  const ids = students.rows.map((r) => r.id as string);

  const enrollments = await db.query(
    `SELECT e.student_id, e.course_id, e.completed_lessons, e.enrolled_at,
            (SELECT max(a.occurred_at) FROM activity_events a WHERE a.enrollment_id = e.id) AS last_active_at
       FROM enrollments e
      WHERE e.student_id = ANY($1::text[])
      ORDER BY e.enrolled_at`,
    [ids],
  );
  // One day of slack so the window is whole in any time zone.
  const since = new Date(now().getTime() - (ACTIVITY_WINDOW_DAYS + 1) * 86_400_000);
  const events = await db.query(
    `SELECT e.student_id, a.occurred_at
       FROM activity_events a JOIN enrollments e ON e.id = a.enrollment_id
      WHERE e.student_id = ANY($1::text[]) AND a.occurred_at >= $2`,
    [ids, since],
  );

  const facts = new Map<string, StudentFacts>(
    students.rows.map((r) => [r.id, { id: r.id, name: r.name, goals: r.goals, enrollments: [], eventTimes: [] }]),
  );
  for (const r of enrollments.rows) {
    const enrollment: Enrollment = {
      courseId: r.course_id,
      completedLessons: r.completed_lessons,
      enrolledAt: r.enrolled_at,
      lastActiveAt: r.last_active_at,
    };
    facts.get(r.student_id)!.enrollments.push(enrollment);
  }
  for (const r of events.rows) facts.get(r.student_id)!.eventTimes.push(r.occurred_at);
  return [...facts.values()];
}

export async function getRoster(db: Queryable, viewer: Viewer): Promise<StudentSummary[]> {
  const catalog = await loadCatalog(db, viewer.centerId);
  const facts = await loadStudentFacts(db, viewer.centerId);
  const at = now();
  return facts
    .map((f) => buildStudentView(f, catalog, at, viewer.timeZone))
    .sort(compareForTriage)
    .map((v) => ({
      id: v.id,
      name: v.name,
      status: v.status,
      goals: v.goals,
      earnedSkills: v.earnedSkills,
      activeDays: v.activeDays,
      activity: v.activity,
      daysSinceActive: v.daysSinceActive,
      atRiskCourses: v.atRiskCourses,
      coursesInProgress: v.courses.filter((c) => c.state !== 'completed').length,
      courses: v.courses.map((c) => ({ courseId: c.courseId, title: c.title, percent: c.percent, state: c.state })),
    }));
}

export async function getStudent(db: Queryable, viewer: Viewer, studentId: string): Promise<StudentView> {
  const [facts] = await loadStudentFacts(db, viewer.centerId, studentId);
  // Same answer whether the learner does not exist or sits in another center.
  if (!facts) throw new HttpError(404, 'student_not_found', 'No learner with that id at this center.');
  const catalog = await loadCatalog(db, viewer.centerId);
  return buildStudentView(facts, catalog, now(), viewer.timeZone);
}

/** Skills a learner can pick as a goal: those some course at this center teaches. */
export async function listSkills(db: Queryable, viewer: Viewer): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT s.id, s.name
       FROM skills s
       JOIN course_skills cs ON cs.skill_id = s.id
       JOIN center_courses cc ON cc.course_id = cs.course_id AND cc.center_id = $1
      ORDER BY s.id`,
    [viewer.centerId],
  );
  return rows;
}

// --- Writes ----------------------------------------------------------------

/** Lock the learner's row so two writes for one learner cannot interleave. */
async function lockStudent(tx: Queryable, viewer: Viewer, studentId: string): Promise<void> {
  const { rowCount } = await tx.query(
    `SELECT 1
       FROM students s
       JOIN center_memberships m ON m.student_id = s.id AND m.left_at IS NULL AND m.center_id = $2
      WHERE s.id = $1
        FOR UPDATE OF s`,
    [studentId, viewer.centerId],
  );
  if (!rowCount) throw new HttpError(404, 'student_not_found', 'No learner with that id at this center.');
}

export async function enroll(db: Db, viewer: Viewer, studentId: string, courseId: string): Promise<StudentView> {
  await transaction(db, async (tx) => {
    await lockStudent(tx, viewer, studentId);
    const catalog = await loadCatalog(tx, viewer.centerId);
    const course = catalog.get(courseId);
    if (!course || !course.offered) {
      throw new HttpError(404, 'course_not_found', 'This center does not offer that course.');
    }
    const [facts] = await loadStudentFacts(tx, viewer.centerId, studentId);
    const enrollments = new Map(facts!.enrollments.map((e) => [e.courseId, e]));
    if (enrollments.has(courseId)) {
      throw new HttpError(409, 'already_enrolled', `Already enrolled in ${course.title}.`);
    }
    const unmet = unmetPrerequisites(course, catalog, enrollments);
    if (unmet.length > 0) {
      throw new HttpError(
        422,
        'prerequisites_incomplete',
        `Finish ${unmet.map((c) => c.title).join(' and ')} before enrolling in ${course.title}.`,
        { unmetPrerequisites: unmet.map((c) => ({ courseId: c.id, title: c.title })) },
      );
    }
    await tx.query(
      `INSERT INTO enrollments (student_id, course_id, center_id, enrolled_at) VALUES ($1, $2, $3, $4)`,
      [studentId, courseId, viewer.centerId, now()],
    );
  });
  return getStudent(db, viewer, studentId);
}

export async function logLesson(db: Db, viewer: Viewer, studentId: string, courseId: string): Promise<StudentView> {
  await transaction(db, async (tx) => {
    await lockStudent(tx, viewer, studentId);
    const updated = await tx.query<{ id: string }>(
      `UPDATE enrollments e
          SET completed_lessons = e.completed_lessons + 1
         FROM courses c
        WHERE c.id = e.course_id AND e.student_id = $1 AND e.course_id = $2
          AND e.completed_lessons < c.total_lessons
    RETURNING e.id`,
      [studentId, courseId],
    );
    const row = updated.rows[0];
    if (!row) {
      const existing = await tx.query('SELECT 1 FROM enrollments WHERE student_id = $1 AND course_id = $2', [
        studentId,
        courseId,
      ]);
      if (!existing.rowCount) throw new HttpError(404, 'not_enrolled', 'Not enrolled in that course.');
      throw new HttpError(409, 'course_complete', 'Every lesson in this course is already done.');
    }
    await tx.query('INSERT INTO activity_events (enrollment_id, occurred_at) VALUES ($1, $2)', [row.id, now()]);
  });
  return getStudent(db, viewer, studentId);
}

/** Refuse goal ids that are not skills. */
async function requireSkills(tx: Queryable, skillIds: string[]): Promise<void> {
  const known = await tx.query<{ id: string }>('SELECT id FROM skills WHERE id = ANY($1::text[])', [skillIds]);
  const knownIds = new Set(known.rows.map((r) => r.id));
  const unknown = skillIds.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    throw new HttpError(422, 'unknown_skill', `Unknown skill: ${unknown.join(', ')}.`, { unknown });
  }
}

export async function setGoals(db: Db, viewer: Viewer, studentId: string, skillIds: string[]): Promise<StudentView> {
  const wanted = [...new Set(skillIds)];
  await transaction(db, async (tx) => {
    await lockStudent(tx, viewer, studentId);
    await requireSkills(tx, wanted);
    await tx.query('DELETE FROM student_goals WHERE student_id = $1 AND NOT (skill_id = ANY($2::text[]))', [
      studentId,
      wanted,
    ]);
    await tx.query(
      `INSERT INTO student_goals (student_id, skill_id)
       SELECT $1, unnest($2::text[])
       ON CONFLICT DO NOTHING`,
      [studentId, wanted],
    );
  });
  return getStudent(db, viewer, studentId);
}

/**
 * Onboard a new learner into the coach's own center. One transaction creates
 * the person, their open membership here, and any goals, so a learner can
 * never exist without a center or appear half-made.
 */
export async function createStudent(
  db: Db,
  viewer: Viewer,
  input: { name: string; skillIds: string[] },
): Promise<StudentView> {
  const id = randomUUID();
  const goals = [...new Set(input.skillIds)];
  await transaction(db, async (tx) => {
    await requireSkills(tx, goals);
    await tx.query('INSERT INTO students (id, name) VALUES ($1, $2)', [id, input.name]);
    await tx.query('INSERT INTO center_memberships (student_id, center_id, joined_at) VALUES ($1, $2, $3)', [
      id,
      viewer.centerId,
      now(),
    ]);
    await tx.query('INSERT INTO student_goals (student_id, skill_id) SELECT $1, unnest($2::text[])', [id, goals]);
  });
  return getStudent(db, viewer, id);
}

export async function renameStudent(db: Db, viewer: Viewer, studentId: string, name: string): Promise<StudentView> {
  await transaction(db, async (tx) => {
    await lockStudent(tx, viewer, studentId);
    await tx.query('UPDATE students SET name = $2 WHERE id = $1', [studentId, name]);
  });
  return getStudent(db, viewer, studentId);
}

/**
 * Remove a learner from the coach's center by closing their membership.
 * Nothing is deleted: the person, their enrollments and their progress stay,
 * because a learner is shared across centers and may join another one. A
 * coach can only ever end a membership at their own center.
 */
export async function removeStudent(db: Db, viewer: Viewer, studentId: string): Promise<void> {
  await transaction(db, async (tx) => {
    await lockStudent(tx, viewer, studentId);
    // GREATEST keeps left_at >= joined_at even when the demo clock is pinned
    // to a date before the learner joined.
    await tx.query(
      `UPDATE center_memberships
          SET left_at = GREATEST($3::timestamptz, joined_at)
        WHERE student_id = $1 AND center_id = $2 AND left_at IS NULL`,
      [studentId, viewer.centerId, now()],
    );
  });
}

/**
 * Move a learner to another center: close the open membership, open a new
 * one. Nothing else changes. Goals, enrollments, progress and earned skills
 * hang off the learner, so the new coach sees them and the old coach no
 * longer sees the learner at all.
 */
export async function moveLearner(db: Db, studentId: string, toCenterId: string): Promise<{ from: string; to: string }> {
  return transaction(db, async (tx) => {
    const center = await tx.query('SELECT 1 FROM centers WHERE id = $1', [toCenterId]);
    if (!center.rowCount) throw new HttpError(404, 'center_not_found', `No center with id ${toCenterId}.`);
    const open = await tx.query<{ id: string; center_id: string }>(
      'SELECT id, center_id FROM center_memberships WHERE student_id = $1 AND left_at IS NULL FOR UPDATE',
      [studentId],
    );
    const current = open.rows[0];
    if (!current) throw new HttpError(404, 'student_not_found', `No learner with id ${studentId}.`);
    if (current.center_id === toCenterId) {
      throw new HttpError(409, 'already_there', 'The learner is already at that center.');
    }
    const at = now();
    await tx.query('UPDATE center_memberships SET left_at = GREATEST($2::timestamptz, joined_at) WHERE id = $1', [
      current.id,
      at,
    ]);
    await tx.query('INSERT INTO center_memberships (student_id, center_id, joined_at) VALUES ($1, $2, $3)', [
      studentId,
      toCenterId,
      at,
    ]);
    return { from: current.center_id, to: toCenterId };
  });
}
