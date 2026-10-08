# Setup

How to get Upskill running on your machine: the database, the backend (Express API) and the frontend (React). Windows, macOS and Linux.

The three pieces and their ports:

| Piece | Folder | Runs on |
| --- | --- | --- |
| Database (PostgreSQL) | | `localhost:5432` |
| Backend (Node + Express) | `server/` | http://localhost:4000 |
| Frontend (React + Vite) | `client/` | http://localhost:5173 |

Run every command from the repo root (the folder that contains this file), not from `client/` or `server/`.

## 1. What you need

- **Node.js 20 or newer.** Check with `node -v`.
- **PostgreSQL 14 or newer**, installed locally, or Docker to run it in a container.

## 2. Database

You need two empty databases: `upskill` for the app and `upskill_test` for the tests. Pick one of the three options.

### Option A: PostgreSQL already installed, using the `postgres` user

In a terminal:

```bash
psql -U postgres -c "CREATE DATABASE upskill"
psql -U postgres -c "CREATE DATABASE upskill_test"
```

It asks for the password you chose when you installed PostgreSQL.

On Windows, if `psql` is not recognised, open **SQL Shell (psql)** from the Start menu, press Enter through the prompts, type your password, then run:

```sql
CREATE DATABASE upskill;
CREATE DATABASE upskill_test;
```

Or in pgAdmin: right-click **Databases**, **Create**, **Database**, once for each name.

### Option B: PostgreSQL already installed, with a dedicated user

This matches `.env.example` exactly, so step 3 needs no edits. Run as an admin user in `psql`:

```sql
CREATE ROLE upskill LOGIN PASSWORD 'upskill' CREATEDB;
CREATE DATABASE upskill OWNER upskill;
CREATE DATABASE upskill_test OWNER upskill;
```

### Option C: Docker

```bash
docker compose up -d
```

This starts PostgreSQL 16 on port 5432 with the `upskill` user and both databases. It also matches `.env.example`. If a local PostgreSQL is already using port 5432, stop it first or use option A or B.

## 3. Environment file

Copy the example file to `.env` in the repo root.

```bash
cp .env.example .env        # macOS, Linux, PowerShell
copy .env.example .env      # Windows Command Prompt
```

Then set the two database URLs to match the option you picked. The format is `postgres://USER:PASSWORD@HOST:PORT/DATABASE`.

| Option | `DATABASE_URL` | `TEST_DATABASE_URL` |
| --- | --- | --- |
| A | `postgres://postgres:YOUR_PASSWORD@localhost:5432/upskill` | `postgres://postgres:YOUR_PASSWORD@localhost:5432/upskill_test` |
| B or C | `postgres://upskill:upskill@127.0.0.1:5432/upskill` | `postgres://upskill:upskill@127.0.0.1:5432/upskill_test` |

Two things that commonly go wrong here:

- **Do not add `?sslmode=require`.** A local PostgreSQL does not use SSL, and the connection is refused if you ask for it.
- **Special characters in the password must be URL-encoded.** `@` becomes `%40`, `#` becomes `%23`, `/` becomes `%2F`, `:` becomes `%3A`.

The other settings can stay as they are:

| Setting | Meaning |
| --- | --- |
| `PORT` | Port for the backend. Default 4000. |
| `AS_OF` | Pins "today" to 6 Oct 2026 so the seed data reads as intended. Remove the line to use the real date. |
| `DEFAULT_COACH_ID` | The coach the app signs in as. Leave as `coach-meera`. |

## 4. Install

```bash
npm install
```

One install from the root covers both the frontend and the backend. Installing inside `client/` alone leaves the backend without its packages.

## 5. Create the tables and load the data

```bash
npm run db:setup
```

You should see:

```
Applied: 001_init.sql
Seeded 4 students, 6 courses, 6 enrollments.
```

This runs two steps you can also run on their own:

| Command | What it does |
| --- | --- |
| `npm run db:migrate` | Creates the tables. Safe to run again; it skips what is already applied. |
| `npm run db:seed` | Empties every table and reloads the seed. Use it to reset the data. |

## 6. Run

### Frontend and backend together

```bash
npm run dev
```

Open http://localhost:5173. Press Ctrl+C to stop both.

### One at a time, in two terminals

```bash
npm run dev -w server       # backend on http://localhost:4000
npm run dev -w client       # frontend on http://localhost:5173
```

The frontend sends every `/api` request to the backend, so the backend must be running for the page to load data.

### Check that each piece works

| Check | Expected |
| --- | --- |
| http://localhost:4000/api/health | `{"ok":true}`: the backend is up |
| http://localhost:4000/api/students | JSON with four learners: the backend can reach the database |
| http://localhost:5173 | The roster, with Rohan Mehta at the top marked at risk |

### As one server

```bash
npm run build
npm start
```

This builds the frontend and serves it from the backend, so the whole app is at http://localhost:4000. This is the form to deploy.

## 7. Tests

```bash
npm test
```

Runs 66 tests. The API tests use `TEST_DATABASE_URL` and wipe that database on every run, which is why it must not be the same as `DATABASE_URL`.

## Troubleshooting

| Message | Cause and fix |
| --- | --- |
| `DATABASE_URL is not set` | There is no `.env` in the repo root. Do step 3. |
| `'tsx' is not recognized` or `Cannot find module 'express'` | The backend packages are missing. Run `npm install` from the repo root. |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL is not running. On Windows, start the `postgresql` service in Services. With Docker, run `docker compose up -d`. |
| `password authentication failed` | The user or password in `.env` is wrong, or the password has a special character that is not URL-encoded. |
| `The server does not support SSL connections` | Remove `?sslmode=require` from the URLs in `.env`. |
| `database "upskill" does not exist` | Do step 2. |
| `relation "coaches" does not exist`, or the page says "Something went wrong on the server" | The tables are missing. Run `npm run db:setup`. |
| `Sign in as a coach to continue` | The seed is not loaded, or `DEFAULT_COACH_ID` is missing from `.env`. Run `npm run db:seed`. |
| `EADDRINUSE` on port 4000 | Something else is using the port. Change `PORT` in `.env` and restart `npm run dev`. |
| The page says "The dashboard did not load" | The backend is not running or cannot reach the database. Open http://localhost:4000/api/health, then read the backend's terminal output. |
| Every learner is at risk | `AS_OF` was removed from `.env`, so the 2026 seed is being read on today's date. Put the line back. |

After changing `.env`, stop the backend with Ctrl+C and start it again; it reads the file only at startup.
