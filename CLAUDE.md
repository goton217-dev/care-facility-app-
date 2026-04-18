# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**見守りノート** (Mimamori Note) is a Japanese-language web application for elderly care facility comparison and vital signs tracking. Family members can compare care facilities using 12 evaluation criteria, log vital signs for their elderly relative, and get guidance from an AI secretary (powered by Claude). Care managers (ケアマネージャー) have read-only access.

## Commands

```bash
npm start        # Start the Express server on port 3000 (or $PORT)
node server.js   # Equivalent to npm start
```

There is no build step, test suite, or linter configured.

## Architecture

The app is a classic server-rendered SPA with a REST API backend:

- **`server.js`** — All Express routes, middleware, and business logic. No separate route files.
- **`database.js`** — PostgreSQL pool setup and `initDB()` which creates all tables and seeds default users on first run.
- **`public/index.html`** — Entire frontend: HTML structure, Tailwind CSS (CDN), and all client-side JavaScript in one ~940-line file.
- **`careapp.json`** — Seed data (users, facilities, evaluations) loaded by `initDB()`.

### Database

Five tables: `users`, `facilities`, `evaluations`, `comments`, `vitals`. The `evaluations` table uses a `UNIQUE(facility_id, user_id, item_key)` constraint so inserts are upserted via `ON CONFLICT DO UPDATE`.

**Environment variables required:**
- `DATABASE_URL` — PostgreSQL connection string
- `PORT` — defaults to 3000
- `SESSION_SECRET` — defaults to `'care-facility-secret-2024'`
- `NODE_ENV` — set to `production` to enable PostgreSQL SSL

### Frontend patterns

The frontend uses view-switching (show/hide elements) rather than a routing library. Key globals in `index.html`:

- `EVAL_ITEMS` — array of 12 facility evaluation criteria keys/labels
- `apiFetch(path, options)` — centralized wrapper for all API calls (handles JSON, errors)
- `escHtml(str)` — XSS protection via HTML entity encoding; use this whenever rendering user content

### Backend patterns

- `requireAuth` middleware — rejects unauthenticated requests (401)
- `requireFamily` middleware — rejects non-family role requests (403)
- `now()` helper — returns current datetime formatted in Asia/Tokyo locale (used for all `created_at`/`updated_at` fields)
- Ownership checks on DELETE routes (comments, vitals) compare `req.session.userId` against the record's `user_id`

### AI assistant integration

The `/api/assistant` endpoint uses `claude-opus-4-7` with `thinking: { type: 'enabled', budget_tokens: 8000 }`. It builds a system prompt with the current facility data and user evaluations (as star ratings), then passes the conversation history (last 20 messages). The Anthropic client is initialized with `process.env.ANTHROPIC_API_KEY`.

## Key Conventions

- **Language:** All UI text, variable names for business concepts, and error messages are in Japanese.
- **Timestamps:** `visit_date` and `recorded_date` use `YYYY-MM-DD` ISO format; `created_at`/`updated_at` use JP locale datetime string (e.g. `"2026/3/18 20:10:46"`).
- **Roles:** `'family'` members have write access; `'caregiver'` is read-only.
- **Authentication:** PIN-based login (4-digit, bcrypt-hashed). Sessions expire after 24 hours.
- **SQL:** Always use parameterized queries (`$1`, `$2`, …) via the `pg` library — never string-interpolate user input into queries.
