import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  activityWindow,
  buildStudentView,
  calendarDaysBetween,
  courseState,
  earnedSkills,
  goalPaths,
  isEligible,
  percentComplete,
  recommendNext,
  type Catalog,
  type Course,
  type Enrollment,
  type StudentFacts,
} from '../src/rules.js';

const IST = 'Asia/Kolkata';
const at = (iso: string) => new Date(iso);
const NOW = at('2026-10-06T10:00:00+05:30');

// The provided files, read as-is, so these tests pin the rules to the real seed.
const read = (name: string) => JSON.parse(readFileSync(new URL(`../seed/${name}.json`, import.meta.url), 'utf8'));
const seedCourses: { id: string; title: string; skillsTaught: string[]; prerequisites: string[] }[] = read('courses');
const seedStudents: { id: string; name: string; goals: string[] }[] = read('students');
const seedEnrollments: { studentId: string; courseId: string; enrolledAt: string }[] = read('enrollments');
const seedProgress: {
  studentId: string;
  courseId: string;
  completedLessons: number;
  totalLessons: number;
  lastActiveAt: string;
}[] = read('progress');

const catalog: Catalog = new Map(
  seedCourses.map((c): [string, Course] => [
    c.id,
    {
      id: c.id,
      title: c.title,
      skills: c.skillsTaught,
      prerequisites: c.prerequisites,
      totalLessons: seedProgress.find((p) => p.courseId === c.id)!.totalLessons,
      offered: true,
    },
  ]),
);

function seedFacts(studentId: string): StudentFacts {
  const student = seedStudents.find((s) => s.id === studentId)!;
  const enrollments = seedEnrollments
    .filter((e) => e.studentId === studentId)
    .map((e): Enrollment => {
      const p = seedProgress.find((x) => x.studentId === studentId && x.courseId === e.courseId);
      return {
        courseId: e.courseId,
        completedLessons: p?.completedLessons ?? 0,
        enrolledAt: at(e.enrolledAt),
        lastActiveAt: p ? at(p.lastActiveAt) : null,
      };
    });
  return {
    id: student.id,
    name: student.name,
    goals: student.goals,
    enrollments,
    eventTimes: enrollments.flatMap((e) => (e.lastActiveAt ? [e.lastActiveAt] : [])),
  };
}

const enrollment = (courseId: string, completedLessons: number, lastActiveAt: string | null = null): Enrollment => ({
  courseId,
  completedLessons,
  enrolledAt: at('2026-09-01T09:00:00+05:30'),
  lastActiveAt: lastActiveAt ? at(lastActiveAt) : null,
});

const index = (list: Enrollment[]) => new Map(list.map((e) => [e.courseId, e]));

describe('skills are earned at 80%', () => {
  it('earns nothing at 75% (9 of 12)', () => {
    expect(earnedSkills([enrollment('c2', 9)], catalog)).toEqual([]);
  });

  it('earns the course skills at 83% (10 of 12)', () => {
    expect(earnedSkills([enrollment('c2', 10)], catalog)).toEqual(['frontend', 'javascript']);
  });

  it('earns at exactly 80% (8 of 10)', () => {
    expect(earnedSkills([enrollment('c4', 8)], catalog)).toEqual(['data', 'sql']);
  });

  it('does not round 79.2% up to a skill', () => {
    const odd: Catalog = new Map([
      ['x', { id: 'x', title: 'X', totalLessons: 24, skills: ['x'], prerequisites: [], offered: true }],
    ]);
    expect(percentComplete(19, 24)).toBe(79);
    expect(earnedSkills([enrollment('x', 19)], odd)).toEqual([]);
  });

  it('merges skills from several courses without duplicates', () => {
    expect(earnedSkills([enrollment('c1', 12), enrollment('c2', 12)], catalog)).toEqual([
      'css',
      'frontend',
      'html',
      'javascript',
    ]);
  });
});

describe('at-risk means inactive for more than 3 days', () => {
  const c2 = catalog.get('c2')!;

  it('is on track when last active exactly 3 days ago', () => {
    expect(courseState(enrollment('c2', 5, '2026-10-03T21:10:00+05:30'), c2, NOW, IST)).toBe('on_track');
  });

  it('is at risk when last active 4 days ago', () => {
    expect(courseState(enrollment('c2', 5, '2026-10-02T23:59:00+05:30'), c2, NOW, IST)).toBe('at_risk');
  });

  it('never marks a finished course at risk', () => {
    expect(courseState(enrollment('c2', 12, '2026-08-01T09:00:00+05:30'), c2, NOW, IST)).toBe('completed');
  });

  it('counts from the enrollment date when the learner never started', () => {
    const fresh: Enrollment = { courseId: 'c2', completedLessons: 0, enrolledAt: NOW, lastActiveAt: null };
    expect(courseState(fresh, c2, NOW, IST)).toBe('on_track');
    expect(courseState(enrollment('c2', 0), c2, NOW, IST)).toBe('at_risk');
  });

  it('counts calendar days in the center time zone', () => {
    expect(calendarDaysBetween(at('2026-10-05T23:50:00+05:30'), at('2026-10-06T00:10:00+05:30'), IST)).toBe(1);
    // The same two instants fall on one date in UTC.
    expect(calendarDaysBetween(at('2026-10-05T23:50:00+05:30'), at('2026-10-06T00:10:00+05:30'), 'UTC')).toBe(0);
  });
});

describe('active days in the last 7 days', () => {
  it('covers today and the six days before, oldest first', () => {
    const days = activityWindow([], NOW, IST);
    expect(days.map((d) => d.date)).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
    ]);
  });

  it('counts a day once however many times the learner was active', () => {
    const days = activityWindow([at('2026-10-05T09:00:00+05:30'), at('2026-10-05T21:00:00+05:30')], NOW, IST);
    expect(days.filter((d) => d.active)).toHaveLength(1);
  });

  it('ignores activity 7 or more days ago', () => {
    const days = activityWindow([at('2026-09-29T23:00:00+05:30')], NOW, IST);
    expect(days.filter((d) => d.active)).toHaveLength(0);
  });
});

describe('eligibility needs every prerequisite complete', () => {
  const c3 = catalog.get('c3')!;

  it('blocks React Basics while JavaScript Essentials is at 83%', () => {
    expect(isEligible(c3, catalog, index([enrollment('c1', 12), enrollment('c2', 10)]))).toBe(false);
  });

  it('allows it once JavaScript Essentials is complete', () => {
    expect(isEligible(c3, catalog, index([enrollment('c1', 12), enrollment('c2', 12)]))).toBe(true);
  });

  it('blocks when the prerequisite was never taken', () => {
    expect(isEligible(c3, catalog, index([]))).toBe(false);
  });

  it('allows a course with no prerequisites', () => {
    expect(isEligible(catalog.get('c1')!, catalog, index([]))).toBe(true);
  });
});

describe('the seeded learners on 6 Oct 2026', () => {
  it('Aisha: on track, 2 active days, 4 earned skills', () => {
    const view = buildStudentView(seedFacts('s1'), catalog, NOW, IST);
    expect(view.status).toBe('on_track');
    expect(view.activeDays).toBe(2);
    expect(view.earnedSkills).toEqual(['css', 'frontend', 'html', 'javascript']);
    expect(view.courses.map((c) => [c.courseId, c.percent, c.state])).toEqual([
      ['c2', 83, 'on_track'],
      ['c3', 25, 'on_track'],
      ['c1', 100, 'completed'],
    ]);
  });

  it('Aisha: React Basics is flagged because its prerequisite is not complete', () => {
    const view = buildStudentView(seedFacts('s1'), catalog, NOW, IST);
    expect(view.courses.find((c) => c.courseId === 'c3')!.unmetPrerequisites).toEqual([
      { courseId: 'c2', title: 'JavaScript Essentials' },
    ]);
  });

  it('Rohan: at risk on Building Dashboards, 0 active days', () => {
    const view = buildStudentView(seedFacts('s2'), catalog, NOW, IST);
    expect(view.status).toBe('at_risk');
    expect(view.activeDays).toBe(0);
    expect(view.daysSinceActive).toBe(8);
    expect(view.atRiskCourses).toEqual([{ courseId: 'c5', title: 'Building Dashboards' }]);
    expect(view.earnedSkills).toEqual(['data', 'sql']);
  });

  it('Priya: on track at exactly 3 idle days, nothing earned at 50%', () => {
    const view = buildStudentView(seedFacts('s3'), catalog, NOW, IST);
    expect(view.status).toBe('on_track');
    expect(view.activeDays).toBe(1);
    expect(view.earnedSkills).toEqual([]);
  });

  it('Priya: at risk one day later', () => {
    const view = buildStudentView(seedFacts('s3'), catalog, at('2026-10-07T10:00:00+05:30'), IST);
    expect(view.status).toBe('at_risk');
  });
});

describe('recommend next', () => {
  const recommend = (goals: string[], enrollments: Enrollment[], c: Catalog = catalog) =>
    recommendNext(goals, enrollments, c, NOW, IST);

  it('starts a new learner at the bottom of the chain toward their goal', () => {
    const r = recommend(['dashboards'], []);
    expect(r).toMatchObject({ kind: 'enroll', courseId: 'c4' });
    expect(r.reason).toBe('Next step toward dashboards: it unlocks Building Dashboards. No prerequisites.');
  });

  it('moves to the course that teaches the goal once the prerequisite is complete', () => {
    const r = recommend(['dashboards'], [enrollment('c4', 10)]);
    expect(r).toMatchObject({ kind: 'enroll', courseId: 'c5' });
    expect(r.reason).toBe('Teaches dashboards, a goal not yet earned. Prerequisite complete: SQL Fundamentals.');
  });

  it('does not recommend a course whose prerequisite is only 80% done', () => {
    const r = recommend(['dashboards'], [enrollment('c4', 8, '2026-10-05T09:00:00+05:30')]);
    expect(r).toMatchObject({ kind: 'continue', courseId: 'c4' });
    expect(r.reason).toBe('2 lessons left. Finishing it unlocks Building Dashboards.');
  });

  it('never recommends a course outside the goals', () => {
    for (const student of seedStudents) {
      const facts = seedFacts(student.id);
      const r = recommend(facts.goals, facts.enrollments);
      if (r.kind === 'none') continue;
      expect(r.goalSkills.every((g) => facts.goals.includes(g))).toBe(true);
      expect(r.goalSkills.length).toBeGreaterThan(0);
    }
  });

  it('Aisha: finish the course that blocks the one she already started', () => {
    const facts = seedFacts('s1');
    const r = recommend(facts.goals, facts.enrollments);
    expect(r).toMatchObject({ kind: 'continue', courseId: 'c2' });
    expect(r.reason).toBe('2 lessons left. It is the prerequisite for React Basics, which is already started.');
  });

  it('Rohan: says how far the goal is and that the course has stalled', () => {
    const facts = seedFacts('s2');
    const r = recommend(facts.goals, facts.enrollments);
    expect(r).toMatchObject({ kind: 'continue', courseId: 'c5' });
    expect(r.reason).toBe('7 more lessons to earn dashboards. Idle for 8 days.');
  });

  it('Priya: one course serves both goals', () => {
    const facts = seedFacts('s3');
    const r = recommend(facts.goals, facts.enrollments);
    expect(r).toMatchObject({ kind: 'continue', courseId: 'c6', goalSkills: ['product', 'user-research'] });
    expect(r.reason).toBe('3 more lessons to earn product and user-research.');
  });

  it('prefers the course that serves more goals', () => {
    // c4 teaches sql and leads to dashboards; c6 teaches only product.
    expect(recommend(['product', 'sql', 'dashboards'], [])).toMatchObject({ kind: 'enroll', courseId: 'c4' });
  });

  it('has nothing to recommend without goals', () => {
    expect(recommend([], [])).toMatchObject({ kind: 'none' });
  });

  it('has nothing to recommend when every goal is earned', () => {
    expect(recommend(['sql'], [enrollment('c4', 8)])).toMatchObject({ kind: 'none' });
  });

  it('skips courses this center does not offer', () => {
    const elsewhere: Catalog = new Map([...catalog].map(([id, c]) => [id, { ...c, offered: false }]));
    const r = recommend(['sql'], [], elsewhere);
    expect(r).toEqual({ kind: 'none', reason: 'No course at this center leads to sql yet.' });
  });

  it('terminates on a cyclic catalog', () => {
    const cyclic: Catalog = new Map([
      ['a', { id: 'a', title: 'A', totalLessons: 4, skills: ['x'], prerequisites: ['b'], offered: true }],
      ['b', { id: 'b', title: 'B', totalLessons: 4, skills: [], prerequisites: ['a'], offered: true }],
    ]);
    expect(recommend(['x'], [], cyclic)).toMatchObject({ kind: 'none' });
  });
});

describe('goal path', () => {
  it('lays out the chain to an unearned goal, prerequisites first', () => {
    const [path] = goalPaths(['react'], [enrollment('c1', 12)], catalog);
    expect(path!.earned).toBe(false);
    expect(path!.steps.map((s) => [s.courseId, s.state])).toEqual([
      ['c1', 'done'],
      ['c2', 'ready'],
      ['c3', 'locked'],
    ]);
  });

  it('shows where an earned goal came from', () => {
    const [path] = goalPaths(['sql'], [enrollment('c4', 10)], catalog);
    expect(path).toEqual({
      skillId: 'sql',
      earned: true,
      steps: [{ courseId: 'c4', title: 'SQL Fundamentals', state: 'done', percent: 100 }],
    });
  });
});
