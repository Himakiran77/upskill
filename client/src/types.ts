// The view types are the server's own, imported as types only, so the two
// sides cannot drift. Nothing from the server ends up in the bundle.
import type { StudentView } from '../../server/src/rules';

export type {
  ActivityDay,
  CourseProgress,
  CourseState,
  GoalPath,
  PathStep,
  Recommendation,
  StepState,
  StudentStatus,
  StudentView,
} from '../../server/src/rules';

export type StudentSummary = Pick<
  StudentView,
  'id' | 'name' | 'status' | 'goals' | 'earnedSkills' | 'activeDays' | 'activity' | 'daysSinceActive' | 'atRiskCourses'
> & {
  coursesInProgress: number;
  courses: Pick<StudentView['courses'][number], 'courseId' | 'title' | 'percent' | 'state'>[];
};

export interface Session {
  coach: { id: string; name: string };
  center: { id: string; name: string; timeZone: string };
  asOf: string;
  clockPinned: boolean;
  skills: { id: string; name: string }[];
}

export type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };
