import type { Session, StudentSummary, StudentView } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      signal: init?.signal ?? AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach the server. Check your connection and that the API is running.', 0, 'network');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      body?.error?.message ??
        (response.status >= 500
          ? 'The server is not responding. Try again in a moment.'
          : `The server answered ${response.status}.`),
      response.status,
      body?.error?.code ?? 'unknown',
    );
  }
  return body as T;
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body ? JSON.stringify(body) : undefined });

export const api = {
  session: (signal?: AbortSignal) => call<Session>('/session', { signal }),

  roster: (signal?: AbortSignal) =>
    call<{ students: StudentSummary[] }>('/students', { signal }).then((r) => r.students),

  student: (id: string, signal?: AbortSignal) =>
    call<{ student: StudentView }>(`/students/${encodeURIComponent(id)}`, { signal }).then((r) => r.student),

  enroll: (id: string, courseId: string) =>
    call<{ student: StudentView }>(`/students/${encodeURIComponent(id)}/enrollments`, post({ courseId })).then(
      (r) => r.student,
    ),

  logLesson: (id: string, courseId: string) =>
    call<{ student: StudentView }>(
      `/students/${encodeURIComponent(id)}/enrollments/${encodeURIComponent(courseId)}/lessons`,
      post(),
    ).then((r) => r.student),

  addStudent: (name: string, skillIds: string[]) =>
    call<{ student: StudentView }>('/students', post({ name, skillIds })).then((r) => r.student),

  renameStudent: (id: string, name: string) =>
    call<{ student: StudentView }>(`/students/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }).then((r) => r.student),

  /** Removes the learner from this center. Their records are kept. */
  removeStudent: (id: string) => call<null>(`/students/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  setGoals: (id: string, skillIds: string[]) =>
    call<{ student: StudentView }>(`/students/${encodeURIComponent(id)}/goals`, {
      method: 'PUT',
      body: JSON.stringify({ skillIds }),
    }).then((r) => r.student),
};

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Try again.';
