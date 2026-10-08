import { useState } from 'react';
import { daysAgo, plural } from './format';
import { ActivityStrip, SkillTag, StatusPill } from './parts';
import type { StudentSummary } from './types';

/** One line that tells a coach why this learner is where they are in the list. */
function reason(student: StudentSummary): string {
  const active =
    student.daysSinceActive === null ? 'No activity yet.' : `Last active ${daysAgo(student.daysSinceActive)}.`;
  if (student.status === 'at_risk') {
    const [first, ...rest] = student.atRiskCourses;
    const stalled = rest.length ? `${first!.title} and ${rest.length} more stalled.` : `${first!.title} stalled.`;
    return `${stalled} ${active}`;
  }
  if (student.status === 'on_track') return `${plural(student.coursesInProgress, 'course')} in progress. ${active}`;
  return student.daysSinceActive === null ? 'Not enrolled in anything yet.' : `Nothing in progress. ${active}`;
}

type Filter = 'all' | 'at_risk';

export function Roster({ students, selectedId }: { students: StudentSummary[]; selectedId: string | null }) {
  const [filter, setFilter] = useState<Filter>('all');
  const atRisk = students.filter((s) => s.status === 'at_risk');
  const shown = filter === 'at_risk' ? atRisk : students;

  return (
    <nav className="roster" aria-label="Learners">
      <div className="roster__head">
        <h2>Learners</h2>
        <div className="segmented" role="group" aria-label="Filter learners">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All {students.length}
          </button>
          <button type="button" aria-pressed={filter === 'at_risk'} onClick={() => setFilter('at_risk')}>
            At risk {atRisk.length}
          </button>
        </div>
      </div>

      {students.length === 0 ? (
        <p className="roster__empty">No learners at this center yet. They appear here once they join.</p>
      ) : shown.length === 0 ? (
        <p className="roster__empty">Nobody is at risk right now.</p>
      ) : (
        <ul className="roster__list">
          {shown.map((student) => (
            <li key={student.id}>
              <a
                href={`#/${student.id}`}
                className={`learner learner--${student.status}`}
                aria-current={student.id === selectedId ? 'page' : undefined}
              >
                <div className="learner__top">
                  <span className="learner__name">{student.name}</span>
                  <StatusPill status={student.status} />
                </div>
                <div className="learner__reason">{reason(student)}</div>
                <div className="learner__week">
                  <ActivityStrip days={student.activity} />
                  <span>{student.activeDays} of 7 days active</span>
                </div>
                <div className="learner__skills">
                  {student.goals.length === 0 ? (
                    <span className="muted">No goals set</span>
                  ) : (
                    student.goals.map((g) => <SkillTag key={g} skill={g} earned={student.earnedSkills.includes(g)} />)
                  )}
                  <span className="muted">{plural(student.earnedSkills.length, 'skill')} earned</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

export function RosterSkeleton() {
  return (
    <div className="roster" aria-hidden="true">
      <div className="roster__head">
        <h2>Learners</h2>
      </div>
      <ul className="roster__list">
        {[0, 1, 2].map((i) => (
          <li key={i} className="learner learner--skeleton">
            <span className="skeleton skeleton--line" style={{ width: '55%' }} />
            <span className="skeleton skeleton--line" style={{ width: '85%' }} />
            <span className="skeleton skeleton--line" style={{ width: '40%' }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
