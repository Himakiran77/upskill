import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import '../src/config.js';
import { createPool, type Db } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import { moveLearner } from '../src/service.js';

/**
 * End-to-end through Express and a real Postgres. Needs TEST_DATABASE_URL.
 * The test database is wiped and re-seeded before every test.
 */

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is not set. See .env.example.');
if (url === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must not be the dev database.');

process.env.AS_OF = '2026-10-06T10:00:00+05:30';
process.env.DEFAULT_COACH_ID = 'coach-meera';

let db: Db;
let api: ReturnType<typeof request>;

beforeAll(async () => {
  db = createPool(url);
  // Dropped by name rather than by schema, so a non-superuser role can do it.
  await db.query(`
    DROP TABLE IF EXISTS activity_events, enrollments, center_memberships, center_courses, coaches,
      centers, student_goals, students, course_prerequisites, course_skills, courses, skills,
      schema_migrations CASCADE;
    DROP FUNCTION IF EXISTS enforce_lessons_within_course();`);
  await migrate(db);
  api = request(createApp(db));
});

beforeEach(async () => {
  await seed(db);
});

afterAll(async () => {
  await db.end();
});

/** A second center with its own coach, offering only SQL Fundamentals. */
async function addPune() {
  await db.query(`INSERT INTO centers (id, name) VALUES ('pune', 'Pune Center')`);
  await db.query(`INSERT INTO coaches (id, name, center_id) VALUES ('coach-pune', 'Dev Kulkarni', 'pune')`);
  await db.query(`INSERT INTO center_courses (center_id, course_id) VALUES ('pune', 'c4')`);
}
const asPune = { 'X-Coach-Id': 'coach-pune' };

describe('roster', () => {
  it('lists the center, at-risk first', async () => {
    const res = await api.get('/api/students').expect(200);
    expect(res.body.students.map((s: { name: string; status: string }) => [s.name, s.status])).toEqual([
      ['Rohan Mehta', 'at_risk'],
      ['Priya Nair', 'on_track'],
      ['Aisha Rahman', 'on_track'],
      ['Kabir Shah', 'no_active_courses'],
    ]);
  });

  it('carries goals, earned skills and active days for the picker', async () => {
    const res = await api.get('/api/students').expect(200);
    const aisha = res.body.students.find((s: { id: string }) => s.id === 's1');
    expect(aisha).toMatchObject({
      goals: ['frontend', 'react'],
      earnedSkills: ['css', 'frontend', 'html', 'javascript'],
      activeDays: 2,
      coursesInProgress: 2,
    });
    expect(aisha.activity).toHaveLength(7);
  });

  it('rejects an unknown coach', async () => {
    const res = await api.get('/api/students').set('X-Coach-Id', 'nobody').expect(401);
    expect(res.body.error.code).toBe('unknown_coach');
  });
});

describe('enroll', () => {
  it('adds the course and returns the updated learner', async () => {
    const before = await api.get('/api/students/s4').expect(200);
    expect(before.body.student.courses).toEqual([]);
    expect(before.body.student.recommendation).toMatchObject({ kind: 'enroll', courseId: 'c4' });

    const res = await api.post('/api/students/s4/enrollments').send({ courseId: 'c4' }).expect(201);
    expect(res.body.student.courses).toMatchObject([
      { courseId: 'c4', percent: 0, state: 'on_track', started: false, daysInactive: 0 },
    ]);
    expect(res.body.student.status).toBe('on_track');
    expect(res.body.student.recommendation).toMatchObject({ kind: 'continue', courseId: 'c4' });

    const after = await api.get('/api/students/s4').expect(200);
    expect(after.body.student).toEqual(res.body.student);
  });

  it('refuses a second enrollment in the same course', async () => {
    await api.post('/api/students/s4/enrollments').send({ courseId: 'c4' }).expect(201);
    const res = await api.post('/api/students/s4/enrollments').send({ courseId: 'c4' }).expect(409);
    expect(res.body.error.code).toBe('already_enrolled');
  });

  it('refuses a course whose prerequisite is not complete, and names it', async () => {
    const res = await api.post('/api/students/s4/enrollments').send({ courseId: 'c5' }).expect(422);
    expect(res.body.error).toMatchObject({
      code: 'prerequisites_incomplete',
      message: 'Finish SQL Fundamentals before enrolling in Building Dashboards.',
      details: { unmetPrerequisites: [{ courseId: 'c4', title: 'SQL Fundamentals' }] },
    });
  });

  it('answers 404 for an unknown course and 400 for a bad body', async () => {
    await api.post('/api/students/s4/enrollments').send({ courseId: 'nope' }).expect(404);
    await api.post('/api/students/s4/enrollments').send({}).expect(400);
  });
});

describe('logging lessons', () => {
  const logLesson = () => api.post('/api/students/s4/enrollments/c4/lessons').expect(201);

  it('earns the skill at 80% but only unlocks the next course at 100%', async () => {
    await api.post('/api/students/s4/enrollments').send({ courseId: 'c4' }).expect(201);

    let res = await logLesson();
    expect(res.body.student.activeDays).toBe(1);
    for (let i = 2; i <= 7; i++) res = await logLesson();
    expect(res.body.student.courses[0].percent).toBe(70);
    expect(res.body.student.earnedSkills).toEqual([]);

    res = await logLesson(); // 8 of 10
    expect(res.body.student.earnedSkills).toEqual(['data', 'sql']);
    await api.post('/api/students/s4/enrollments').send({ courseId: 'c5' }).expect(422);

    await logLesson();
    res = await logLesson(); // 10 of 10
    expect(res.body.student.courses[0]).toMatchObject({ percent: 100, state: 'completed' });
    expect(res.body.student.recommendation).toMatchObject({ kind: 'enroll', courseId: 'c5' });
    await api.post('/api/students/s4/enrollments').send({ courseId: 'c5' }).expect(201);
  });

  it('refuses a lesson past the end of the course', async () => {
    const res = await api.post('/api/students/s2/enrollments/c4/lessons').expect(409);
    expect(res.body.error.code).toBe('course_complete');
  });

  it('refuses a lesson in a course the learner is not enrolled in', async () => {
    await api.post('/api/students/s4/enrollments/c1/lessons').expect(404);
  });

  it('brings an at-risk learner back on track', async () => {
    const res = await api.post('/api/students/s2/enrollments/c5/lessons').expect(201);
    expect(res.body.student.status).toBe('on_track');
    expect(res.body.student.daysSinceActive).toBe(0);
  });
});

describe('goals', () => {
  it('replaces the goals and the recommendation follows', async () => {
    const res = await api.put('/api/students/s3/goals').send({ skillIds: ['sql'] }).expect(200);
    expect(res.body.student.goals).toEqual(['sql']);
    expect(res.body.student.recommendation).toMatchObject({ kind: 'enroll', courseId: 'c4' });
  });

  it('refuses a skill that does not exist', async () => {
    const res = await api.put('/api/students/s3/goals').send({ skillIds: ['juggling'] }).expect(422);
    expect(res.body.error.code).toBe('unknown_skill');
  });
});

describe('a coach sees only their center', () => {
  beforeEach(addPune);

  it('shows an empty roster to a coach whose center has no learners', async () => {
    const res = await api.get('/api/students').set(asPune).expect(200);
    expect(res.body.students).toEqual([]);
  });

  it('answers 404 for a learner in another center, on reads and writes', async () => {
    await api.get('/api/students/s1').set(asPune).expect(404);
    await api.post('/api/students/s4/enrollments').set(asPune).send({ courseId: 'c4' }).expect(404);
    await api.post('/api/students/s1/enrollments/c2/lessons').set(asPune).expect(404);
    await api.put('/api/students/s1/goals').set(asPune).send({ skillIds: [] }).expect(404);
  });

  it('reports the right center in the session', async () => {
    const res = await api.get('/api/session').set(asPune).expect(200);
    expect(res.body.center).toMatchObject({ id: 'pune', name: 'Pune Center' });
    // Only skills a course at this center teaches can be picked as goals.
    expect(res.body.skills.map((s: { id: string }) => s.id)).toEqual(['data', 'sql']);
  });
});

describe('a learner can move', () => {
  beforeEach(addPune);

  it('takes progress, skills and goals along and leaves the old roster', async () => {
    const before = (await api.get('/api/students/s1').expect(200)).body.student;
    expect(await moveLearner(db, 's1', 'pune')).toEqual({ from: 'blr', to: 'pune' });

    await api.get('/api/students/s1').expect(404);
    const blr = await api.get('/api/students').expect(200);
    expect(blr.body.students.map((s: { id: string }) => s.id)).not.toContain('s1');

    const after = (await api.get('/api/students/s1').set(asPune).expect(200)).body.student;
    expect(after.courses).toEqual(before.courses);
    expect(after.earnedSkills).toEqual(before.earnedSkills);
    expect(after.goals).toEqual(before.goals);
  });

  it('keeps the membership history', async () => {
    await moveLearner(db, 's1', 'pune');
    const { rows } = await db.query(
      `SELECT center_id, left_at IS NULL AS open FROM center_memberships WHERE student_id = 's1' ORDER BY id`,
    );
    expect(rows).toEqual([
      { center_id: 'blr', open: false },
      { center_id: 'pune', open: true },
    ]);
  });

  it('only offers the new center courses after the move', async () => {
    await moveLearner(db, 's4', 'pune');
    // Pune offers SQL Fundamentals but not Building Dashboards.
    await api.post('/api/students/s4/enrollments').set(asPune).send({ courseId: 'c1' }).expect(404);
    await api.post('/api/students/s4/enrollments').set(asPune).send({ courseId: 'c4' }).expect(201);
    const { rows } = await db.query(`SELECT center_id FROM enrollments WHERE student_id = 's4'`);
    expect(rows).toEqual([{ center_id: 'pune' }]);
  });
});

describe('the database refuses bad rows on its own', () => {
  it('a learner cannot be in two centers at once', async () => {
    await addPune();
    await expect(
      db.query(`INSERT INTO center_memberships (student_id, center_id, joined_at) VALUES ('s1', 'pune', now())`),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('a learner cannot be enrolled in the same course twice', async () => {
    await expect(
      db.query(`INSERT INTO enrollments (student_id, course_id, center_id, enrolled_at) VALUES ('s1', 'c1', 'blr', now())`),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('completed lessons cannot exceed the course', async () => {
    await expect(
      db.query(`UPDATE enrollments SET completed_lessons = 13 WHERE student_id = 's1' AND course_id = 'c1'`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('an enrollment cannot name a center that does not offer the course', async () => {
    await addPune();
    await expect(
      db.query(`INSERT INTO enrollments (student_id, course_id, center_id, enrolled_at) VALUES ('s4', 'c1', 'pune', now())`),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('a course cannot be its own prerequisite', async () => {
    await expect(
      db.query(`INSERT INTO course_prerequisites (course_id, prerequisite_id) VALUES ('c1', 'c1')`),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
