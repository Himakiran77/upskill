import { dayLabel, weekdayInitial } from './format';
import type { ActivityDay, CourseState, StudentStatus } from './types';

const statusText: Record<StudentStatus | CourseState, string> = {
  at_risk: 'At risk',
  on_track: 'On track',
  completed: 'Completed',
  no_active_courses: 'No active courses',
};

export function StatusPill({ status }: { status: StudentStatus | CourseState }) {
  return <span className={`pill pill--${status}`}>{statusText[status]}</span>;
}

export function SkillTag({ skill, earned }: { skill: string; earned?: boolean }) {
  return (
    <span className={`tag${earned ? ' tag--earned' : ''}`}>
      {earned && (
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
          <path d="M2 6.4 4.8 9 10 3.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {skill}
      {earned && <span className="visually-hidden"> (earned)</span>}
    </span>
  );
}

/**
 * The last 7 days as seven marks, oldest on the left, today on the right.
 * Compact in the roster; with weekday initials in the learner view.
 */
export function ActivityStrip({ days, labelled = false }: { days: ActivityDay[]; labelled?: boolean }) {
  const active = days.filter((d) => d.active).length;
  return (
    <ol
      className={`strip${labelled ? ' strip--labelled' : ''}`}
      aria-label={`Active on ${active} of the last ${days.length} days`}
    >
      {days.map((day, i) => (
        <li
          key={day.date}
          className={`strip__day${day.active ? ' is-active' : ''}${i === days.length - 1 ? ' is-today' : ''}`}
          title={`${dayLabel(day.date)}: ${day.active ? 'active' : 'no activity'}`}
        >
          {labelled && <span aria-hidden="true">{weekdayInitial(day.date)}</span>}
        </li>
      ))}
    </ol>
  );
}

/** A progress bar with a fixed mark at 80%, where the course's skills are earned. */
export function ProgressBar({ percent, state, label }: { percent: number; state: CourseState; label: string }) {
  return (
    <div
      className={`bar bar--${state}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <div className="bar__fill" style={{ width: `${percent}%` }} />
      <div className="bar__mark" aria-hidden="true" />
    </div>
  );
}

export function ErrorPanel({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="panel panel--error" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
