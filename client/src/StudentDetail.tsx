import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, messageOf } from './api';
import { daysAgo, plural, shortDate } from './format';
import { ActivityStrip, ErrorPanel, ProgressBar, SkillTag, StatusPill } from './parts';
import type { CourseProgress, GoalPath, Load, PathStep, Recommendation, Session, StudentView } from './types';

interface Props {
  studentId: string;
  session: Session;
  /** Called after any change so the roster can re-sort. */
  onChanged: () => void;
}

type Notice = { tone: 'ok' | 'error'; text: string };

export function StudentDetail({ studentId, session, onChanged }: Props) {
  const [state, setState] = useState<Load<StudentView>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editingGoals, setEditingGoals] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    setNotice(null);
    setEditingGoals(false);
    api
      .student(studentId, controller.signal)
      .then((data) => {
        setState({ status: 'ready', data });
        // On a phone the roster is replaced by this view; move focus with it.
        heading.current?.focus({ preventScroll: true });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setMissing(error instanceof ApiError && error.status === 404);
        setState({ status: 'error', message: messageOf(error) });
      });
    return () => controller.abort();
  }, [studentId, attempt]);

  /** Run a change, swap in the learner the server sends back, tell the roster. */
  const run = useCallback(
    async (key: string, change: () => Promise<StudentView>, done: string) => {
      setPending(key);
      setNotice(null);
      try {
        const data = await change();
        setState({ status: 'ready', data });
        setNotice({ tone: 'ok', text: done });
        onChanged();
        return true;
      } catch (error) {
        setNotice({ tone: 'error', text: messageOf(error) });
        return false;
      } finally {
        setPending(null);
      }
    },
    [onChanged],
  );

  if (state.status === 'loading') return <DetailSkeleton />;
  if (state.status === 'error') {
    return (
      <div className="detail">
        <BackLink />
        {missing ? (
          // Retrying cannot help: the learner is not at this center.
          <div className="panel">
            <h2>No such learner here</h2>
            <p>This link points to a learner who is not at your center. They may have moved.</p>
            <a className="link" href="#/">
              See all learners
            </a>
          </div>
        ) : (
          <ErrorPanel
            title="This learner did not load"
            message={state.message}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        )}
      </div>
    );
  }

  const student = state.data;
  const busy = pending !== null;
  const enroll = (courseId: string, title: string) =>
    run(`enroll:${courseId}`, () => api.enroll(student.id, courseId), `Enrolled in ${title}. It is in the course list below.`);
  const logLesson = (courseId: string, title: string) =>
    run(`lesson:${courseId}`, () => api.logLesson(student.id, courseId), `Logged a lesson in ${title}.`);

  return (
    <article className="detail" aria-busy={busy}>
      <BackLink />

      <header className="who">
        <div className="who__name">
          <h1 ref={heading} tabIndex={-1}>
            {student.name}
          </h1>
          <StatusPill status={student.status} />
        </div>
        <p className="who__summary">{summary(student)}</p>

        <dl className="facts">
          <div className="facts__row">
            <dt>Goals</dt>
            <dd>
              {editingGoals ? (
                <GoalEditor
                  current={student.goals}
                  skills={session.skills}
                  saving={pending === 'goals'}
                  onCancel={() => setEditingGoals(false)}
                  onSave={async (skillIds) => {
                    if (await run('goals', () => api.setGoals(student.id, skillIds), 'Goals saved.')) {
                      setEditingGoals(false);
                    }
                  }}
                />
              ) : (
                <div className="tags">
                  {student.goals.length === 0 && <span className="muted">No goals yet.</span>}
                  {student.goals.map((g) => (
                    <SkillTag key={g} skill={g} earned={student.earnedSkills.includes(g)} />
                  ))}
                  <button type="button" className="link" disabled={busy} onClick={() => setEditingGoals(true)}>
                    {student.goals.length === 0 ? 'Add goals' : 'Change goals'}
                  </button>
                </div>
              )}
            </dd>
          </div>
          <div className="facts__row">
            <dt>Earned skills</dt>
            <dd>
              {student.earnedSkills.length === 0 ? (
                <span className="muted">None yet. A skill is earned at 80% of a course that teaches it.</span>
              ) : (
                <div className="tags">
                  {student.earnedSkills.map((s) => (
                    <SkillTag key={s} skill={s} earned />
                  ))}
                </div>
              )}
            </dd>
          </div>
          <div className="facts__row">
            <dt>Last 7 days</dt>
            <dd className="facts__week">
              <ActivityStrip days={student.activity} labelled />
              <span>
                <strong>{student.activeDays} of 7</strong> days active
              </span>
            </dd>
          </div>
        </dl>
      </header>

      <div className="notice-slot" aria-live="polite">
        {notice && <p className={`notice notice--${notice.tone}`}>{notice.text}</p>}
      </div>

      <RecommendNext
        recommendation={student.recommendation}
        pending={pending}
        busy={busy}
        onEnroll={enroll}
        onLogLesson={logLesson}
        onAddGoals={() => setEditingGoals(true)}
      />

      <section className="section" aria-labelledby="courses-heading">
        <div className="section__head">
          <h2 id="courses-heading">Courses</h2>
          {student.courses.length > 0 && <p className="muted">The mark at 80% is where a course's skills are earned.</p>}
        </div>
        {student.courses.length === 0 ? (
          <p className="empty">
            {student.name.split(' ')[0]} is not enrolled in anything yet.
            {student.recommendation.kind === 'enroll' && ' Enroll in the recommended course to start.'}
          </p>
        ) : (
          <ul className="courses">
            {student.courses.map((course) => (
              <CourseRow
                key={course.courseId}
                course={course}
                earnedSkills={student.earnedSkills}
                timeZone={session.center.timeZone}
                busy={busy}
                saving={pending === `lesson:${course.courseId}`}
                onLogLesson={() => logLesson(course.courseId, course.title)}
              />
            ))}
          </ul>
        )}
      </section>

      {student.goalPaths.length > 0 && (
        <section className="section" aria-labelledby="paths-heading">
          <div className="section__head">
            <h2 id="paths-heading">Path to each goal</h2>
          </div>
          <ul className="paths">
            {student.goalPaths.map((path) => (
              <GoalPathRow key={path.skillId} path={path} />
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function summary(student: StudentView): string {
  const active =
    student.daysSinceActive === null ? 'No activity yet.' : `Last active ${daysAgo(student.daysSinceActive)}.`;
  if (student.status === 'at_risk') {
    const titles = student.atRiskCourses.map((c) => c.title).join(' and ');
    return `No activity on ${titles} for more than 3 days. ${active}`;
  }
  if (student.status === 'on_track') return `No open course has been idle for more than 3 days. ${active}`;
  return student.courses.length === 0 ? 'Not enrolled in anything yet.' : `Nothing in progress. ${active}`;
}

function BackLink() {
  return (
    <a className="back" href="#/">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      All learners
    </a>
  );
}

function RecommendNext({
  recommendation: r,
  pending,
  busy,
  onEnroll,
  onLogLesson,
  onAddGoals,
}: {
  recommendation: Recommendation;
  pending: string | null;
  busy: boolean;
  onEnroll: (courseId: string, title: string) => void;
  onLogLesson: (courseId: string, title: string) => void;
  onAddGoals: () => void;
}) {
  if (r.kind === 'none') {
    return (
      <section className="next next--none" aria-labelledby="next-heading">
        <h2 id="next-heading">Recommended next</h2>
        <p className="next__reason">{r.reason}</p>
        <button type="button" className="button" disabled={busy} onClick={onAddGoals}>
          Change goals
        </button>
      </section>
    );
  }
  const enrolling = pending === `enroll:${r.courseId}`;
  const logging = pending === `lesson:${r.courseId}`;
  return (
    <section className="next" aria-labelledby="next-heading">
      <h2 id="next-heading">Recommended next</h2>
      <p className="next__course">{r.kind === 'enroll' ? r.title : `Keep going with ${r.title}`}</p>
      <p className="next__reason">{r.reason}</p>
      {r.kind === 'enroll' ? (
        <button
          type="button"
          className="button button--sun"
          disabled={busy}
          onClick={() => onEnroll(r.courseId, r.title)}
        >
          {enrolling ? 'Enrolling…' : `Enroll in ${r.title}`}
        </button>
      ) : (
        <button
          type="button"
          className="button button--sun"
          disabled={busy}
          onClick={() => onLogLesson(r.courseId, r.title)}
        >
          {logging ? 'Logging…' : 'Log a lesson'}
        </button>
      )}
    </section>
  );
}

function CourseRow({
  course,
  earnedSkills,
  timeZone,
  busy,
  saving,
  onLogLesson,
}: {
  course: CourseProgress;
  /** Everything the learner has earned, from any course. */
  earnedSkills: string[];
  timeZone: string;
  busy: boolean;
  saving: boolean;
  onLogLesson: () => void;
}) {
  let when: string;
  if (course.state === 'completed' && course.lastActiveAt) {
    when = `Finished ${shortDate(course.lastActiveAt, timeZone)}`;
  } else if (course.lastActiveAt) {
    when = `Last active ${shortDate(course.lastActiveAt, timeZone)}, ${daysAgo(course.daysInactive)}`;
  } else {
    when = `Not started. Enrolled ${shortDate(course.enrolledAt, timeZone)}, ${daysAgo(course.daysInactive)}`;
  }
  return (
    <li className={`course course--${course.state}`}>
      <div className="course__top">
        <h3>{course.title}</h3>
        <StatusPill status={course.state} />
      </div>
      <div className="course__progress">
        <ProgressBar percent={course.percent} state={course.state} label={`${course.title} progress`} />
        <span className="course__percent">{course.percent}%</span>
      </div>
      <p className="course__meta">
        <span>
          {course.completedLessons} of {plural(course.totalLessons, 'lesson')}
        </span>
        <span>{when}</span>
      </p>
      {course.unmetPrerequisites.length > 0 && (
        <p className="course__flag">
          Started before {course.unmetPrerequisites.map((c) => c.title).join(' and ')} was finished.
        </p>
      )}
      <div className="course__foot">
        <div className="tags">
          <span className="visually-hidden">Teaches </span>
          {course.skills.map((s) => (
            <SkillTag key={s} skill={s} earned={earnedSkills.includes(s)} />
          ))}
        </div>
        {course.state !== 'completed' && (
          <button type="button" className="button button--quiet" disabled={busy} onClick={onLogLesson}>
            {saving ? 'Logging…' : 'Log a lesson'}
          </button>
        )}
      </div>
    </li>
  );
}

const stepText: Record<PathStep['state'], string> = {
  done: 'Complete',
  in_progress: 'In progress',
  ready: 'Ready to start',
  locked: 'Locked',
  unavailable: 'Not offered here',
};

function GoalPathRow({ path }: { path: GoalPath }) {
  return (
    <li className="path">
      <div className="path__goal">
        <SkillTag skill={path.skillId} earned={path.earned} />
        <span className="muted">{path.earned ? 'Earned' : 'Not earned yet'}</span>
      </div>
      {path.steps.length === 0 ? (
        <p className="muted">No course at this center teaches this yet.</p>
      ) : (
        <ol className="path__steps">
          {path.steps.map((step) => (
            <li key={step.courseId} className={`step step--${step.state}`}>
              <span className="step__node" aria-hidden="true" />
              <span className="step__text">
                <span className="step__title">{step.title}</span>
                <span className="step__state">
                  {step.state === 'in_progress' ? `${step.percent}% done` : stepText[step.state]}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function GoalEditor({
  current,
  skills,
  saving,
  onSave,
  onCancel,
}: {
  current: string[];
  skills: Session['skills'];
  saving: boolean;
  onSave: (skillIds: string[]) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState(() => new Set(current));
  const toggle = (id: string) =>
    setPicked((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Keep a goal that no course here teaches visible, so saving cannot drop it silently.
  const options = [...new Set([...skills.map((s) => s.id), ...current])].sort();
  return (
    <form
      className="goal-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave([...picked]);
      }}
    >
      <fieldset disabled={saving}>
        <legend className="visually-hidden">Pick goals</legend>
        <div className="tags">
          {options.map((id) => (
            <label key={id} className={`choice${picked.has(id) ? ' is-picked' : ''}`}>
              <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id)} />
              {id}
            </label>
          ))}
        </div>
        <div className="goal-editor__actions">
          <button type="submit" className="button">
            {saving ? 'Saving…' : 'Save goals'}
          </button>
          <button type="button" className="button button--quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function DetailSkeleton() {
  return (
    <div className="detail" aria-busy="true">
      <p className="visually-hidden" role="status">
        Loading learner
      </p>
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--line" style={{ width: '60%' }} />
      <div className="skeleton skeleton--block" />
      <div className="skeleton skeleton--block" />
      <div className="skeleton skeleton--block" />
    </div>
  );
}
