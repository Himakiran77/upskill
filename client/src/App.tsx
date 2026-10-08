import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api, messageOf } from './api';
import { longDate } from './format';
import { ErrorPanel } from './parts';
import { Roster, RosterSkeleton } from './Roster';
import { StudentDetail } from './StudentDetail';
import type { Load, Session, StudentSummary } from './types';

/** The selected learner lives in the URL hash (#/s1): linkable, and Back works on a phone. */
function useSelectedId(): string | null {
  const hash = useSyncExternalStore(
    (onChange) => {
      window.addEventListener('hashchange', onChange);
      return () => window.removeEventListener('hashchange', onChange);
    },
    () => window.location.hash,
  );
  const id = decodeURIComponent(hash.replace(/^#\/?/, ''));
  return id || null;
}

const wideQuery = '(min-width: 900px)';

/** True when the roster and the learner fit side by side. */
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(wideQuery);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(wideQuery).matches,
  );
}

interface Boot {
  session: Session;
  students: StudentSummary[];
}

export function App() {
  const [boot, setBoot] = useState<Load<Boot>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const hashId = useSelectedId();
  const wide = useWide();

  useEffect(() => {
    const controller = new AbortController();
    setBoot({ status: 'loading' });
    Promise.all([api.session(controller.signal), api.roster(controller.signal)])
      .then(([session, students]) => setBoot({ status: 'ready', data: { session, students } }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setBoot({ status: 'error', message: messageOf(error) });
      });
    return () => controller.abort();
  }, [attempt]);

  /** Re-read the roster after a change. A failure here keeps the list already on screen. */
  const refreshRoster = useCallback(() => {
    api
      .roster()
      .then((students) =>
        setBoot((before) => (before.status === 'ready' ? { status: 'ready', data: { ...before.data, students } } : before)),
      )
      .catch(() => undefined);
  }, []);

  const session = boot.status === 'ready' ? boot.data.session : null;
  const students = boot.status === 'ready' ? boot.data.students : [];
  // With room for both panes, open the learner at the top of the triage list.
  const selectedId = hashId ?? (wide ? (students[0]?.id ?? null) : null);

  return (
    <div className="app">
      <header className="topbar">
        <a className="topbar__brand" href="#/">
          Upskill
        </a>
        {session && (
          <>
            <span className="topbar__center">{session.center.name}</span>
            <span className="topbar__meta">
              <span>{session.coach.name}</span>
              <span
                className="topbar__date"
                title={session.clockPinned ? 'The date is pinned by AS_OF so the seed data reads as intended.' : undefined}
              >
                {longDate(session.asOf, session.center.timeZone)}
                {session.clockPinned && <span className="topbar__pinned">demo clock</span>}
              </span>
            </span>
          </>
        )}
      </header>

      <main className={`shell ${hashId ? 'shell--detail' : 'shell--list'}`}>
        {boot.status === 'loading' && (
          <>
            <p className="visually-hidden" role="status">
              Loading learners
            </p>
            <RosterSkeleton />
          </>
        )}

        {boot.status === 'error' && (
          <div className="shell__full">
            <ErrorPanel
              title="The dashboard did not load"
              message={boot.message}
              onRetry={() => setAttempt((n) => n + 1)}
            />
          </div>
        )}

        {boot.status === 'ready' && session && (
          <>
            <Roster students={students} selectedId={selectedId} />
            <div className="shell__detail">
              {selectedId ? (
                <StudentDetail key={selectedId} studentId={selectedId} session={session} onChanged={refreshRoster} />
              ) : (
                <p className="empty empty--center">
                  {students.length === 0 ? 'Nothing to show until a learner joins.' : 'Pick a learner to see their courses.'}
                </p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
