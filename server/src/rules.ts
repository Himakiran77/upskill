/**
 * Every product rule lives in this file as a pure function: no database, no
 * clock, no HTTP. The service loads rows and hands them here.
 */

// --- The numbers the rules turn on -----------------------------------------

/** A skill is earned when a course that teaches it is at least 80% complete. */
export const SKILL_EARNED_AT_PERCENT = 80;
/** A prerequisite counts as complete when every lesson is done. */
export const PREREQUISITE_COMPLETE_AT_PERCENT = 100;
/** At-risk means inactive for more than this many days. */
export const AT_RISK_AFTER_DAYS = 3;
/** "Active days in the last 7 days": today and the six days before it. */
export const ACTIVITY_WINDOW_DAYS = 7;

// --- Inputs ----------------------------------------------------------------

export interface Course {
  id: string;
  title: string;
  totalLessons: number;
  skills: string[];
  prerequisites: string[];
  /** Offered at the learner's current center. Only offered courses are recommended. */
  offered: boolean;
}

export interface Enrollment {
  courseId: string;
  completedLessons: number;
  enrolledAt: Date;
  /** Most recent activity event, or null if the learner has not started. */
  lastActiveAt: Date | null;
}

export type Catalog = ReadonlyMap<string, Course>;

// --- Outputs ---------------------------------------------------------------

export type CourseState = 'completed' | 'on_track' | 'at_risk';
export type StudentStatus = 'at_risk' | 'on_track' | 'no_active_courses';
export type StepState = 'done' | 'in_progress' | 'ready' | 'locked' | 'unavailable';

export interface CourseRef {
  courseId: string;
  title: string;
}

export interface CourseProgress extends CourseRef {
  skills: string[];
  completedLessons: number;
  totalLessons: number;
  percent: number;
  state: CourseState;
  started: boolean;
  /** Calendar days since the last activity, or since enrolling if never active. */
  daysInactive: number;
  enrolledAt: string;
  lastActiveAt: string | null;
  /** Prerequisites not yet complete. Normally empty; see README on imported data. */
  unmetPrerequisites: CourseRef[];
}

export interface ActivityDay {
  date: string;
  active: boolean;
}

export type Recommendation =
  | ({ kind: 'enroll'; reason: string; goalSkills: string[] } & CourseRef)
  | ({ kind: 'continue'; reason: string; goalSkills: string[] } & CourseRef)
  | { kind: 'none'; reason: string };

export interface PathStep extends CourseRef {
  state: StepState;
  percent: number | null;
}

export interface GoalPath {
  skillId: string;
  earned: boolean;
  steps: PathStep[];
}

export interface StudentView {
  id: string;
  name: string;
  status: StudentStatus;
  goals: string[];
  earnedSkills: string[];
  activeDays: number;
  activity: ActivityDay[];
  daysSinceActive: number | null;
  courses: CourseProgress[];
  atRiskCourses: CourseRef[];
  recommendation: Recommendation;
  goalPaths: GoalPath[];
}

// --- Calendar days ---------------------------------------------------------

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar date of an instant in a time zone, as YYYY-MM-DD. */
export function localDay(instant: Date, timeZone: string): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter.format(instant);
}

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/**
 * Whole calendar days from one instant to another in a time zone. Sunday
 * 23:50 to Monday 00:10 is 1 day; a learner active "4 days ago" reads the
 * same at 9am and 9pm.
 */
export function calendarDaysBetween(earlier: Date, later: Date, timeZone: string): number {
  return dayNumber(localDay(later, timeZone)) - dayNumber(localDay(earlier, timeZone));
}

// --- Progress --------------------------------------------------------------

type Progress = Pick<Enrollment, 'completedLessons'>;

/** Rounded down, so the screen never shows 80% for a skill that is not earned. */
export function percentComplete(completedLessons: number, totalLessons: number): number {
  return Math.floor((completedLessons * 100) / totalLessons);
}

// Compared as integers so 79.9% can never round its way to a skill.
const reaches = (enrollment: Progress, course: Course, percent: number) =>
  enrollment.completedLessons * 100 >= percent * course.totalLessons;

export const earnsSkills = (enrollment: Progress, course: Course) =>
  reaches(enrollment, course, SKILL_EARNED_AT_PERCENT);

export const isComplete = (enrollment: Progress, course: Course) =>
  reaches(enrollment, course, PREREQUISITE_COMPLETE_AT_PERCENT);

/** Lessons still needed before the course's skills count as earned. */
export function lessonsUntilSkillsEarned(enrollment: Progress, course: Course): number {
  const needed = Math.ceil((SKILL_EARNED_AT_PERCENT * course.totalLessons) / 100);
  return Math.max(0, needed - enrollment.completedLessons);
}

export function daysInactive(enrollment: Enrollment, now: Date, timeZone: string): number {
  return Math.max(0, calendarDaysBetween(enrollment.lastActiveAt ?? enrollment.enrolledAt, now, timeZone));
}

/** A finished course is never at risk; an unfinished one is after 3 idle days. */
export function courseState(enrollment: Enrollment, course: Course, now: Date, timeZone: string): CourseState {
  if (isComplete(enrollment, course)) return 'completed';
  return daysInactive(enrollment, now, timeZone) > AT_RISK_AFTER_DAYS ? 'at_risk' : 'on_track';
}

// --- Activity --------------------------------------------------------------

/** The last 7 calendar days, oldest first, each marked active or not. */
export function activityWindow(eventTimes: Date[], now: Date, timeZone: string): ActivityDay[] {
  const activeDays = new Set(eventTimes.map((t) => localDay(t, timeZone)));
  const today = dayNumber(localDay(now, timeZone));
  const days: ActivityDay[] = [];
  for (let back = ACTIVITY_WINDOW_DAYS - 1; back >= 0; back--) {
    const date = new Date((today - back) * DAY_MS).toISOString().slice(0, 10);
    days.push({ date, active: activeDays.has(date) });
  }
  return days;
}

// --- Skills and eligibility ------------------------------------------------

type EnrollmentsByCourse = ReadonlyMap<string, Enrollment>;

const indexByCourse = (enrollments: Enrollment[]): EnrollmentsByCourse =>
  new Map(enrollments.map((e) => [e.courseId, e]));

export function earnedSkills(enrollments: Enrollment[], catalog: Catalog): string[] {
  const earned = new Set<string>();
  for (const enrollment of enrollments) {
    const course = catalog.get(enrollment.courseId);
    if (course && earnsSkills(enrollment, course)) course.skills.forEach((s) => earned.add(s));
  }
  return [...earned].sort();
}

/** Prerequisites the learner has not completed. Empty means eligible. */
export function unmetPrerequisites(course: Course, catalog: Catalog, enrollments: EnrollmentsByCourse): Course[] {
  const unmet: Course[] = [];
  for (const id of course.prerequisites) {
    const prerequisite = catalog.get(id);
    if (!prerequisite) continue;
    const enrollment = enrollments.get(id);
    if (!enrollment || !isComplete(enrollment, prerequisite)) unmet.push(prerequisite);
  }
  return unmet;
}

export function isEligible(course: Course, catalog: Catalog, enrollments: EnrollmentsByCourse): boolean {
  return unmetPrerequisites(course, catalog, enrollments).length === 0;
}

/**
 * A course and everything it transitively requires, prerequisites first.
 * distance is how many steps a course sits before the target (target = 0).
 * The visited set makes a cyclic catalog terminate instead of hanging.
 */
function chainTo(target: Course, catalog: Catalog): { course: Course; distance: number }[] {
  const distance = new Map<string, number>();
  const order: Course[] = [];
  const visit = (course: Course, depth: number, path: Set<string>) => {
    if (path.has(course.id)) return;
    const known = distance.get(course.id);
    if (known === undefined || depth < known) distance.set(course.id, depth);
    const nextPath = new Set(path).add(course.id);
    for (const id of course.prerequisites) {
      const prerequisite = catalog.get(id);
      if (prerequisite) visit(prerequisite, depth + 1, nextPath);
    }
    if (!order.includes(course)) order.push(course);
  };
  visit(target, 0, new Set());
  return order.map((course) => ({ course, distance: distance.get(course.id)! }));
}

// --- Recommend next --------------------------------------------------------

interface Needed {
  course: Course;
  /** Unearned goals this course teaches or leads to. */
  goals: Set<string>;
  /** 0 when it teaches a goal directly, else steps before a course that does. */
  distance: number;
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * One next step for the learner.
 *
 * 1. Collect every course that teaches an unearned goal, plus everything
 *    those courses require. Nothing outside that set is ever recommended.
 * 2. If one of them is offered here, not yet enrolled and eligible, recommend
 *    enrolling. Prefer the course that serves the most goals, then the one
 *    closest to a goal, then the shortest.
 * 3. Otherwise the learner is already enrolled in everything that helps, so
 *    point at the enrolled course to finish first: the one that blocks others.
 * 4. Otherwise say plainly why there is nothing to recommend.
 */
export function recommendNext(
  goals: string[],
  enrollments: Enrollment[],
  catalog: Catalog,
  now: Date,
  timeZone: string,
): Recommendation {
  if (goals.length === 0) {
    return { kind: 'none', reason: 'No goals yet. Add a goal and the first course toward it appears here.' };
  }
  const byCourse = indexByCourse(enrollments);
  const earned = new Set(earnedSkills(enrollments, catalog));
  const unearned = goals.filter((g) => !earned.has(g));
  if (unearned.length === 0) {
    return { kind: 'none', reason: 'Every goal is earned. Add a new goal to get the next course.' };
  }

  const needed = new Map<string, Needed>();
  for (const goal of unearned) {
    for (const target of catalog.values()) {
      if (!target.skills.includes(goal)) continue;
      for (const { course, distance } of chainTo(target, catalog)) {
        const entry = needed.get(course.id) ?? { course, goals: new Set<string>(), distance };
        entry.goals.add(goal);
        entry.distance = Math.min(entry.distance, distance);
        needed.set(course.id, entry);
      }
    }
  }

  /** The needed course this one is a prerequisite for, if any. */
  const unlocks = (course: Course) =>
    [...needed.values()].map((n) => n.course).find((c) => c.prerequisites.includes(course.id));

  const toEnroll = [...needed.values()]
    .filter((n) => n.course.offered && !byCourse.has(n.course.id) && isEligible(n.course, catalog, byCourse))
    .sort(
      (a, b) =>
        b.goals.size - a.goals.size ||
        a.distance - b.distance ||
        a.course.totalLessons - b.course.totalLessons ||
        a.course.id.localeCompare(b.course.id),
    )[0];

  if (toEnroll) {
    const { course, distance } = toEnroll;
    const goalSkills = [...toEnroll.goals].sort();
    const prerequisites = course.prerequisites.map((id) => catalog.get(id)?.title ?? id);
    const cleared =
      prerequisites.length === 0 ? 'No prerequisites.' : `Prerequisite complete: ${listOf(prerequisites)}.`;
    const next = unlocks(course);
    const taught = goalSkills.filter((g) => course.skills.includes(g));
    const why =
      distance === 0 || !next
        ? `Teaches ${listOf(taught)}, ${taught.length === 1 ? 'a goal' : 'goals'} not yet earned.`
        : `Next step toward ${listOf(goalSkills)}: it unlocks ${next.title}.`;
    return { kind: 'enroll', courseId: course.id, title: course.title, goalSkills, reason: `${why} ${cleared}` };
  }

  const inProgress = [...needed.values()]
    .map((n) => ({ ...n, enrollment: byCourse.get(n.course.id) }))
    .filter((n): n is Needed & { enrollment: Enrollment } => !!n.enrollment && !isComplete(n.enrollment, n.course))
    .map((n) => ({
      ...n,
      workable: isEligible(n.course, catalog, byCourse),
      atRisk: courseState(n.enrollment, n.course, now, timeZone) === 'at_risk',
    }))
    .sort(
      (a, b) =>
        Number(b.workable) - Number(a.workable) || // nothing unfinished underneath it
        b.distance - a.distance || // the course that blocks others first
        Number(b.atRisk) - Number(a.atRisk) ||
        b.enrollment.completedLessons / b.course.totalLessons - a.enrollment.completedLessons / a.course.totalLessons ||
        a.course.id.localeCompare(b.course.id),
    )[0];

  if (inProgress) {
    const { course, enrollment } = inProgress;
    const goalSkills = [...inProgress.goals].sort();
    const left = course.totalLessons - enrollment.completedLessons;
    const next = unlocks(course);
    let reason: string;
    if (next && byCourse.has(next.id)) {
      reason = `${plural(left, 'lesson')} left. It is the prerequisite for ${next.title}, which is already started.`;
    } else if (next) {
      reason = `${plural(left, 'lesson')} left. Finishing it unlocks ${next.title}.`;
    } else {
      const toEarn = lessonsUntilSkillsEarned(enrollment, course);
      const taught = listOf(goalSkills.filter((g) => course.skills.includes(g)));
      reason = `${plural(toEarn, 'more lesson')} to earn ${taught}.`;
    }
    if (inProgress.atRisk) reason += ` Idle for ${plural(daysInactive(enrollment, now, timeZone), 'day')}.`;
    return { kind: 'continue', courseId: course.id, title: course.title, goalSkills, reason };
  }

  return { kind: 'none', reason: `No course at this center leads to ${listOf(unearned)} yet.` };
}

// --- Goal path -------------------------------------------------------------

/** For each goal, the courses that lead to it and where the learner stands on each. */
export function goalPaths(goals: string[], enrollments: Enrollment[], catalog: Catalog): GoalPath[] {
  const byCourse = indexByCourse(enrollments);
  const earned = new Set(earnedSkills(enrollments, catalog));

  const step = (course: Course): PathStep => {
    const enrollment = byCourse.get(course.id);
    let state: StepState;
    if (enrollment) state = isComplete(enrollment, course) ? 'done' : 'in_progress';
    else if (!course.offered) state = 'unavailable';
    else state = isEligible(course, catalog, byCourse) ? 'ready' : 'locked';
    return {
      courseId: course.id,
      title: course.title,
      state,
      percent: enrollment ? percentComplete(enrollment.completedLessons, course.totalLessons) : null,
    };
  };
  const fraction = (course: Course) => (byCourse.get(course.id)?.completedLessons ?? -1) / course.totalLessons;

  return goals.map((skillId) => {
    const teaching = [...catalog.values()].filter((c) => c.skills.includes(skillId));
    if (earned.has(skillId)) {
      // Show the course that earned it, not a path that is already walked.
      const source = teaching
        .filter((c) => byCourse.has(c.id) && earnsSkills(byCourse.get(c.id)!, c))
        .sort((a, b) => fraction(b) - fraction(a) || a.id.localeCompare(b.id))[0];
      return { skillId, earned: true, steps: source ? [step(source)] : [] };
    }
    // Follow the route the learner is furthest along; failing that, the shortest.
    const target = teaching
      .map((course) => ({ course, chain: chainTo(course, catalog) }))
      .sort(
        (a, b) =>
          fraction(b.course) - fraction(a.course) ||
          a.chain.length - b.chain.length ||
          a.course.id.localeCompare(b.course.id),
      )[0];
    return { skillId, earned: false, steps: target ? target.chain.map((c) => step(c.course)) : [] };
  });
}

// --- The whole learner -----------------------------------------------------

export interface StudentFacts {
  id: string;
  name: string;
  goals: string[];
  enrollments: Enrollment[];
  /** Activity timestamps across the learner's courses, covering at least the last 7 days. */
  eventTimes: Date[];
}

const stateOrder: Record<CourseState, number> = { at_risk: 0, on_track: 1, completed: 2 };

export function buildStudentView(facts: StudentFacts, catalog: Catalog, now: Date, timeZone: string): StudentView {
  const byCourse = indexByCourse(facts.enrollments);

  const courses: CourseProgress[] = [];
  for (const enrollment of facts.enrollments) {
    const course = catalog.get(enrollment.courseId);
    if (!course) continue;
    const state = courseState(enrollment, course, now, timeZone);
    courses.push({
      courseId: course.id,
      title: course.title,
      skills: [...course.skills],
      completedLessons: enrollment.completedLessons,
      totalLessons: course.totalLessons,
      percent: percentComplete(enrollment.completedLessons, course.totalLessons),
      state,
      started: enrollment.lastActiveAt !== null || enrollment.completedLessons > 0,
      daysInactive: daysInactive(enrollment, now, timeZone),
      enrolledAt: enrollment.enrolledAt.toISOString(),
      lastActiveAt: enrollment.lastActiveAt?.toISOString() ?? null,
      unmetPrerequisites:
        state === 'completed'
          ? []
          : unmetPrerequisites(course, catalog, byCourse).map((c) => ({ courseId: c.id, title: c.title })),
    });
  }
  // Stalled courses first, longest-idle on top; finished courses last.
  courses.sort(
    (a, b) =>
      stateOrder[a.state] - stateOrder[b.state] ||
      (a.state === 'at_risk' ? b.daysInactive - a.daysInactive : b.percent - a.percent) ||
      a.title.localeCompare(b.title),
  );

  const atRiskCourses = courses
    .filter((c) => c.state === 'at_risk')
    .map((c) => ({ courseId: c.courseId, title: c.title }));
  const hasUnfinished = courses.some((c) => c.state !== 'completed');
  const status: StudentStatus =
    atRiskCourses.length > 0 ? 'at_risk' : hasUnfinished ? 'on_track' : 'no_active_courses';

  const activity = activityWindow(facts.eventTimes, now, timeZone);
  const latest = facts.enrollments.reduce<Date | null>(
    (max, e) => (e.lastActiveAt && (!max || e.lastActiveAt > max) ? e.lastActiveAt : max),
    null,
  );

  return {
    id: facts.id,
    name: facts.name,
    status,
    goals: [...facts.goals],
    earnedSkills: earnedSkills(facts.enrollments, catalog),
    activeDays: activity.filter((d) => d.active).length,
    activity,
    daysSinceActive: latest ? Math.max(0, calendarDaysBetween(latest, now, timeZone)) : null,
    courses,
    atRiskCourses,
    recommendation: recommendNext(facts.goals, facts.enrollments, catalog, now, timeZone),
    goalPaths: goalPaths(facts.goals, facts.enrollments, catalog),
  };
}

const statusOrder: Record<StudentStatus, number> = { at_risk: 0, on_track: 1, no_active_courses: 2 };

/** Roster order: at-risk first, longest-quiet on top, then by name. */
export function compareForTriage(a: StudentView, b: StudentView): number {
  return (
    statusOrder[a.status] - statusOrder[b.status] ||
    (b.daysSinceActive ?? -1) - (a.daysSinceActive ?? -1) ||
    a.name.localeCompare(b.name)
  );
}
