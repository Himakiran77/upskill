import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { databaseUrl, now, serverRoot } from './config.js';
import { createPool, transaction, type Db } from './db.js';

/**
 * Imports the provided JSON files into the normalized tables. JSON is read
 * here and nowhere else; the app only ever talks to Postgres.
 *
 * Destructive: it empties every table first, so it is safe to re-run.
 */

const seedDir = path.join(serverRoot, 'seed');

const studentSchema = z.object({ id: z.string(), name: z.string(), goals: z.array(z.string()) });
const courseSchema = z.object({
  id: z.string(),
  title: z.string(),
  skillsTaught: z.array(z.string()),
  prerequisites: z.array(z.string()),
});
const enrollmentSchema = z.object({
  studentId: z.string(),
  courseId: z.string(),
  enrolledAt: z.string().datetime({ offset: true }),
});
const progressSchema = z.object({
  studentId: z.string(),
  courseId: z.string(),
  completedLessons: z.number().int().nonnegative(),
  totalLessons: z.number().int().positive(),
  lastActiveAt: z.string().datetime({ offset: true }),
});
const additionsSchema = z.object({
  center: z.object({ id: z.string(), name: z.string(), timezone: z.string() }),
  coach: z.object({ id: z.string(), name: z.string() }),
  students: z.array(studentSchema),
});

async function readJson<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await fs.readFile(path.join(seedDir, file), 'utf8');
  return schema.parse(JSON.parse(raw));
}

const key = (studentId: string, courseId: string) => `${studentId}:${courseId}`;

export async function seed(db: Db): Promise<{ students: number; courses: number; enrollments: number }> {
  const additions = await readJson('additions.json', additionsSchema);
  const students = [...(await readJson('students.json', z.array(studentSchema))), ...additions.students];
  const courses = await readJson('courses.json', z.array(courseSchema));
  const enrollments = await readJson('enrollments.json', z.array(enrollmentSchema));
  const progress = await readJson('progress.json', z.array(progressSchema));

  // progress.json repeats totalLessons on every row. It is a fact about the
  // course, so it is stored once on courses. Refuse rows that disagree.
  const totalLessons = new Map<string, number>();
  for (const row of progress) {
    const known = totalLessons.get(row.courseId);
    if (known !== undefined && known !== row.totalLessons) {
      throw new Error(`progress.json disagrees on totalLessons for ${row.courseId}`);
    }
    totalLessons.set(row.courseId, row.totalLessons);
  }

  const enrolled = new Set(enrollments.map((e) => key(e.studentId, e.courseId)));
  for (const row of progress) {
    if (!enrolled.has(key(row.studentId, row.courseId))) {
      throw new Error(`progress.json has ${row.studentId}/${row.courseId} with no enrollment`);
    }
  }
  const progressByKey = new Map(progress.map((p) => [key(p.studentId, p.courseId), p]));

  const skillIds = new Set<string>();
  for (const course of courses) course.skillsTaught.forEach((s) => skillIds.add(s));
  for (const student of students) student.goals.forEach((s) => skillIds.add(s));

  const { center, coach } = additions;

  await transaction(db, async (tx) => {
    await tx.query(`
      TRUNCATE activity_events, enrollments, center_memberships, center_courses, coaches,
               centers, student_goals, students, course_prerequisites, course_skills,
               courses, skills
      RESTART IDENTITY CASCADE`);

    await tx.query('INSERT INTO centers (id, name, timezone) VALUES ($1, $2, $3)', [
      center.id,
      center.name,
      center.timezone,
    ]);
    await tx.query('INSERT INTO coaches (id, name, center_id) VALUES ($1, $2, $3)', [
      coach.id,
      coach.name,
      center.id,
    ]);

    for (const id of skillIds) {
      await tx.query('INSERT INTO skills (id, name) VALUES ($1, $2)', [id, id.replace(/-/g, ' ')]);
    }

    for (const course of courses) {
      const total = totalLessons.get(course.id);
      if (total === undefined) throw new Error(`No totalLessons found for course ${course.id}`);
      await tx.query('INSERT INTO courses (id, title, total_lessons) VALUES ($1, $2, $3)', [
        course.id,
        course.title,
        total,
      ]);
      await tx.query('INSERT INTO center_courses (center_id, course_id) VALUES ($1, $2)', [
        center.id,
        course.id,
      ]);
    }
    for (const course of courses) {
      for (const skillId of course.skillsTaught) {
        await tx.query('INSERT INTO course_skills (course_id, skill_id) VALUES ($1, $2)', [course.id, skillId]);
      }
      for (const prerequisiteId of course.prerequisites) {
        await tx.query('INSERT INTO course_prerequisites (course_id, prerequisite_id) VALUES ($1, $2)', [
          course.id,
          prerequisiteId,
        ]);
      }
    }

    for (const student of students) {
      await tx.query('INSERT INTO students (id, name) VALUES ($1, $2)', [student.id, student.name]);
      for (const skillId of student.goals) {
        await tx.query('INSERT INTO student_goals (student_id, skill_id) VALUES ($1, $2)', [student.id, skillId]);
      }
      // A learner joined the center when they first enrolled; a learner with
      // no enrollments joined today.
      const firstEnrollment = enrollments
        .filter((e) => e.studentId === student.id)
        .map((e) => new Date(e.enrolledAt).getTime())
        .sort((a, b) => a - b)[0];
      await tx.query('INSERT INTO center_memberships (student_id, center_id, joined_at) VALUES ($1, $2, $3)', [
        student.id,
        center.id,
        firstEnrollment === undefined ? now() : new Date(firstEnrollment),
      ]);
    }

    for (const enrollment of enrollments) {
      const row = progressByKey.get(key(enrollment.studentId, enrollment.courseId));
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO enrollments (student_id, course_id, center_id, enrolled_at, completed_lessons)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [enrollment.studentId, enrollment.courseId, center.id, enrollment.enrolledAt, row?.completedLessons ?? 0],
      );
      // The seed only knows the most recent activity per course, so that is
      // the one event imported. No history is invented.
      if (row) {
        await tx.query('INSERT INTO activity_events (enrollment_id, occurred_at) VALUES ($1, $2)', [
          inserted.rows[0]!.id,
          row.lastActiveAt,
        ]);
      }
    }
  });

  return { students: students.length, courses: courses.length, enrollments: enrollments.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = createPool(databaseUrl());
  try {
    const counts = await seed(db);
    console.log(`Seeded ${counts.students} students, ${counts.courses} courses, ${counts.enrollments} enrollments.`);
  } finally {
    await db.end();
  }
}
