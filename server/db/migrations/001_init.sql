-- Upskill schema.
-- Shared across centers: skills, courses, course_skills, course_prerequisites,
--                        students, student_goals.
-- Per center:            centers, coaches, center_courses, center_memberships,
--                        enrollments (attributed to a center), activity_events.

-- ---------------------------------------------------------------------------
-- Shared catalog
-- ---------------------------------------------------------------------------

CREATE TABLE skills (
  id   text PRIMARY KEY,              -- slug, e.g. 'user-research'
  name text NOT NULL
);

CREATE TABLE courses (
  id            text PRIMARY KEY,
  title         text NOT NULL,
  total_lessons integer NOT NULL CHECK (total_lessons > 0)
);

-- A course teaches many skills; a skill can be taught by many courses.
CREATE TABLE course_skills (
  course_id text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  skill_id  text NOT NULL REFERENCES skills (id),
  PRIMARY KEY (course_id, skill_id)
);
CREATE INDEX course_skills_skill_idx ON course_skills (skill_id);

-- Self-referencing many-to-many: course_id requires prerequisite_id.
CREATE TABLE course_prerequisites (
  course_id       text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  prerequisite_id text NOT NULL REFERENCES courses (id),
  PRIMARY KEY (course_id, prerequisite_id),
  CHECK (course_id <> prerequisite_id)
);

-- ---------------------------------------------------------------------------
-- Shared people
-- ---------------------------------------------------------------------------

-- A learner is one person everywhere. Identity never belongs to a center,
-- which is what lets a learner move without losing anything.
CREATE TABLE students (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Goals are skills the learner wants. They travel with the learner.
CREATE TABLE student_goals (
  student_id text NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  skill_id   text NOT NULL REFERENCES skills (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, skill_id)
);

-- ---------------------------------------------------------------------------
-- Centers
-- ---------------------------------------------------------------------------

CREATE TABLE centers (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  -- "Days" in the at-risk and active-day rules are calendar days here.
  timezone text NOT NULL DEFAULT 'Asia/Kolkata'
);

-- A coach belongs to exactly one center. Every read is scoped through this.
CREATE TABLE coaches (
  id        text PRIMARY KEY,
  name      text NOT NULL,
  center_id text NOT NULL REFERENCES centers (id)
);
CREATE INDEX coaches_center_idx ON coaches (center_id);

-- Which shared courses a center offers.
CREATE TABLE center_courses (
  center_id text NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  PRIMARY KEY (center_id, course_id)
);

-- Where a learner is, and where they have been. Moving a learner closes the
-- open row (left_at) and opens a new one. The partial unique index guarantees
-- at most one open row per learner.
CREATE TABLE center_memberships (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id text NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  center_id  text NOT NULL REFERENCES centers (id),
  joined_at  timestamptz NOT NULL,
  left_at    timestamptz,
  CHECK (left_at IS NULL OR left_at >= joined_at)
);
CREATE UNIQUE INDEX center_memberships_one_open_per_student
  ON center_memberships (student_id) WHERE left_at IS NULL;
CREATE INDEX center_memberships_center_open_idx
  ON center_memberships (center_id) WHERE left_at IS NULL;

-- ---------------------------------------------------------------------------
-- Learning records
-- ---------------------------------------------------------------------------

-- One row per learner per course, ever. The row belongs to the learner, so
-- progress follows them when they move. center_id records where the course
-- was taken and can only name a center that offers it.
CREATE TABLE enrollments (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id        text NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  course_id         text NOT NULL REFERENCES courses (id),
  center_id         text NOT NULL REFERENCES centers (id),
  enrolled_at       timestamptz NOT NULL,
  completed_lessons integer NOT NULL DEFAULT 0 CHECK (completed_lessons >= 0),
  UNIQUE (student_id, course_id),
  FOREIGN KEY (center_id, course_id) REFERENCES center_courses (center_id, course_id)
);
CREATE INDEX enrollments_course_idx ON enrollments (course_id);
CREATE INDEX enrollments_center_idx ON enrollments (center_id);

-- completed_lessons can never exceed the course's lesson count.
CREATE FUNCTION enforce_lessons_within_course() RETURNS trigger AS $$
BEGIN
  IF NEW.completed_lessons >
     (SELECT total_lessons FROM courses WHERE id = NEW.course_id) THEN
    RAISE EXCEPTION 'completed_lessons exceeds total_lessons for course %', NEW.course_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enrollments_lessons_within_course
  BEFORE INSERT OR UPDATE OF completed_lessons, course_id ON enrollments
  FOR EACH ROW EXECUTE FUNCTION enforce_lessons_within_course();

-- One row each time a learner works on a course. "Last active" and "active
-- days in the last 7" are both read from here; neither is stored.
CREATE TABLE activity_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enrollment_id bigint NOT NULL REFERENCES enrollments (id) ON DELETE CASCADE,
  occurred_at   timestamptz NOT NULL
);
CREATE INDEX activity_events_enrollment_time_idx
  ON activity_events (enrollment_id, occurred_at DESC);
