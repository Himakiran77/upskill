import type { ReactNode } from 'react';
import { dayLabel, dayOfMonth, initials, weekdayInitial } from './format';
import type { ActivityDay, CourseState, StudentStatus } from './types';

// --- Icons -----------------------------------------------------------------
// One small stroked set, drawn on a 16px grid so they sit on the text baseline.

const paths = {
  check: 'M3 8.5 6.5 12 13 4.5',
  clock: 'M8 4.5V8l2.2 1.6M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z',
  target: 'M8 8h.01M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z',
  award: 'M5.5 9.5 4.5 14 8 12.2l3.5 1.8-1-4.5M12 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  calendar: 'M5 2v2.5M11 2v2.5M2.5 6.5h11M3.5 3.5h9a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z',
  book: 'M8 4.2C6.6 3.3 4.8 3 2.5 3v9c2.3 0 4.1.3 5.5 1.2M8 4.2C9.4 3.3 11.2 3 13.5 3v9c-2.3 0-4.1.3-5.5 1.2M8 4.2v9',
  lock: 'M5 7V5a3 3 0 0 1 6 0v2M4 7h8a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z',
  alert: 'M8 5.5V9m0 2.2h.01M7.1 2.6 1.9 11.5a1 1 0 0 0 .9 1.5h10.4a1 1 0 0 0 .9-1.5L8.9 2.6a1 1 0 0 0-1.8 0Z',
  plus: 'M8 3.5v9M3.5 8h9',
  route: 'M4 4.5h5.5a2.5 2.5 0 0 1 0 5h-3a2.5 2.5 0 0 0 0 5H12M4 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm11 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path
        d={paths[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// --- Status and skills -----------------------------------------------------

const statusText: Record<StudentStatus | CourseState, string> = {
  at_risk: 'At risk',
  on_track: 'On track',
  completed: 'Completed',
  no_active_courses: 'No active courses',
};

export function StatusPill({ status }: { status: StudentStatus | CourseState }) {
  return (
    <span className={`pill pill--${status}`}>
      <span className="pill__dot" aria-hidden="true" />
      {statusText[status]}
    </span>
  );
}

/** A skill. Outlined while it is only a goal or on offer; filled green with a tick once earned. */
export function SkillTag({ skill, earned }: { skill: string; earned?: boolean }) {
  return (
    <span className={`tag${earned ? ' tag--earned' : ''}`}>
      {earned && <Icon name="check" size={12} />}
      {skill}
      {earned && <span className="visually-hidden"> (earned)</span>}
    </span>
  );
}

export function Avatar({ name, status }: { name: string; status: StudentStatus }) {
  return (
    <span className={`avatar avatar--${status}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

// --- Activity --------------------------------------------------------------

/**
 * The last 7 days, oldest on the left, today on the right: weekday initial
 * over the date, filled yellow on the days the learner was active.
 */
export function ActivityStrip({ days }: { days: ActivityDay[] }) {
  const active = days.filter((d) => d.active).length;
  return (
    <ol className="strip strip--full" aria-label={`Active on ${active} of the last ${days.length} days`}>
      {days.map((day, i) => (
        <li
          key={day.date}
          className={`strip__day${day.active ? ' is-active' : ''}${i === days.length - 1 ? ' is-today' : ''}`}
          title={`${dayLabel(day.date)}: ${day.active ? 'active' : 'no activity'}`}
        >
          <span className="strip__weekday" aria-hidden="true">
            {weekdayInitial(day.date)}
          </span>
          <span className="strip__date" aria-hidden="true">
            {dayOfMonth(day.date)}
          </span>
        </li>
      ))}
    </ol>
  );
}

// --- Progress --------------------------------------------------------------

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

// --- Containers ------------------------------------------------------------

/** A bordered panel with an icon, a title and an optional figure on the right. */
export function Card({
  icon,
  title,
  aside,
  tone = 'board',
  wide,
  children,
}: {
  icon: IconName;
  title: string;
  aside?: ReactNode;
  /** Colour of the icon tile: green for goals, lighter green for earned, yellow for activity. */
  tone?: 'board' | 'track' | 'sun';
  /** Take the full row. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`card card--${tone}${wide ? ' card--wide' : ''}`}>
      <header className="card__head">
        <span className="card__icon">
          <Icon name={icon} />
        </span>
        <h2>{title}</h2>
        {aside && <span className="card__aside">{aside}</span>}
      </header>
      <div className="card__body">{children}</div>
    </section>
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
