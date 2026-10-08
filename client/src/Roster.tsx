import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, messageOf } from './api';
import { daysAgo, plural } from './format';
import { Avatar, Icon, SkillTag, StatusPill } from './parts';
import type { Session, StudentSummary, StudentView } from './types';

const lastActive = (student: StudentSummary) =>
  student.daysSinceActive === null ? 'No activity yet' : `Last active ${daysAgo(student.daysSinceActive)}`;

/** Why an at-risk learner is at risk, in a few words. */
function stalled(student: StudentSummary): string {
  const [first, ...rest] = student.atRiskCourses;
  if (!first) return '';
  return rest.length ? `${first.title} and ${rest.length} more stalled` : `${first.title} stalled`;
}

type Filter = 'all' | 'at_risk';

interface RosterProps {
  students: StudentSummary[];
  selectedId: string | null;
  /** Skills a new learner can be given as goals. */
  skills: Session['skills'];
  /** Called with the learner the server created. */
  onAdded: (student: StudentView) => void;
}

export function Roster({ students, selectedId, skills, onAdded }: RosterProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);
  const atRisk = students.filter((s) => s.status === 'at_risk');
  const shown = filter === 'at_risk' ? atRisk : students;

  return (
    <nav className="roster" aria-label="Learners">
      <div className="roster__head">
        <h2>Learners</h2>
        <button type="button" className="button button--small" aria-expanded={adding} onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
          Add learner
        </button>
        <div className="segmented" role="group" aria-label="Filter learners">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All <span className="segmented__count">{students.length}</span>
          </button>
          <button type="button" aria-pressed={filter === 'at_risk'} onClick={() => setFilter('at_risk')}>
            At risk <span className="segmented__count">{atRisk.length}</span>
          </button>
        </div>
      </div>

      {adding && (
        <AddLearnerForm
          skills={skills}
          onCancel={() => setAdding(false)}
          onAdded={(student) => {
            setAdding(false);
            // A new learner is never at risk; make sure the list shows them.
            setFilter('all');
            onAdded(student);
          }}
        />
      )}

      {students.length === 0 ? (
        !adding && <p className="roster__empty">No learners at this center yet. Add the first one to get started.</p>
      ) : shown.length === 0 ? (
        <p className="roster__empty">Nobody is at risk right now.</p>
      ) : (
        <ul className="roster__list">
          {shown.map((student) => (
            <li key={student.id}>
              <LearnerCard student={student} selected={student.id === selectedId} />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

function AddLearnerForm({
  skills,
  onAdded,
  onCancel,
}: {
  skills: Session['skills'];
  onAdded: (student: StudentView) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState(() => new Set<string>());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => nameInput.current?.focus(), []);

  const toggle = (id: string) =>
    setPicked((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter the learner's name.");
      nameInput.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onAdded(await api.addStudent(trimmed, [...picked]));
    } catch (failure) {
      setError(messageOf(failure));
      setSaving(false);
    }
  }

  return (
    <form className="add-form" onSubmit={submit} noValidate>
      <h3>Add a learner</h3>
      <label className="field">
        <span>Name</span>
        <input
          ref={nameInput}
          type="text"
          value={name}
          maxLength={80}
          autoComplete="off"
          disabled={saving}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
      </label>
      <fieldset className="field" disabled={saving}>
        <legend>
          Goals <span className="muted">(optional, can be set later)</span>
        </legend>
        <div className="tags">
          {skills.map((skill) => (
            <label key={skill.id} className={`choice choice--small${picked.has(skill.id) ? ' is-picked' : ''}`}>
              <input type="checkbox" checked={picked.has(skill.id)} onChange={() => toggle(skill.id)} />
              {skill.id}
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <div className="add-form__actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'Adding…' : 'Add learner'}
        </button>
        <button type="button" className="button button--quiet" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function LearnerCard({ student, selected }: { student: StudentSummary; selected: boolean }) {
  const open = student.courses.filter((c) => c.state !== 'completed');
  const finished = student.courses.length - open.length;

  return (
    <a
      href={`#/${student.id}`}
      className={`learner learner--${student.status}`}
      aria-current={selected ? 'page' : undefined}
    >
      <div className="learner__top">
        <Avatar name={student.name} status={student.status} />
        <div className="learner__who">
          <span className="learner__name">{student.name}</span>
          <span className="learner__active">
            <Icon name="clock" size={13} />
            {lastActive(student)}
          </span>
        </div>
        <StatusPill status={student.status} />
      </div>

      {student.status === 'at_risk' && (
        <p className="learner__alert">
          <Icon name="alert" size={14} />
          {stalled(student)}
        </p>
      )}

      {/* Course progress: one thin track per open course. */}
      <div className="learner__courses">
        {student.courses.length === 0 && <span className="learner__none">Not enrolled in anything yet</span>}
        {open.map((course) => (
          <div key={course.courseId} className={`mini mini--${course.state}`}>
            <span className="mini__title">{course.title}</span>
            <span className="mini__percent">{course.percent}%</span>
            <span className="mini__track" aria-hidden="true">
              <span className="mini__fill" style={{ width: `${course.percent}%` }} />
            </span>
          </div>
        ))}
        {finished > 0 && (
          <span className="learner__finished">
            <Icon name="check" size={13} />
            {open.length === 0 ? `All ${plural(finished, 'course')} completed` : `${plural(finished, 'course')} completed`}
          </span>
        )}
      </div>

      {/* <p className="learner__week">
        <Icon name="calendar" size={14} />
        <span className="learner__days">
          <strong>{student.activeDays}</strong> of 7 days active
        </span>
      </p> */}

      <dl className="learner__skills">
        <div>
          <dt>
            <Icon name="target" size={13} />
            Goals
          </dt>
          <dd>
            {student.goals.length === 0 ? (
              <span className="muted">None set</span>
            ) : (
              student.goals.map((g) => <SkillTag key={g} skill={g} earned={student.earnedSkills.includes(g)} />)
            )}
          </dd>
        </div>
        <div>
          <dt>
            <Icon name="award" size={13} />
            Earned
          </dt>
          <dd>
            {student.earnedSkills.length === 0 ? (
              <span className="muted">None yet</span>
            ) : (
              student.earnedSkills.map((s) => <SkillTag key={s} skill={s} earned />)
            )}
          </dd>
        </div>
      </dl>
    </a>
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
