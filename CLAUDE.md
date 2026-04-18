# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

「見守りノート」(Care Watch Note) is a Japanese-language care facility comparison and health tracking app. It helps families compare elder care facilities, record evaluations, manage health vitals, and get AI guidance via the Anthropic Claude API.

## Commands

```bash
# Install dependencies
npm install

# Start the server (default port 3000)
npm start
# or
node server.js
```

There are no tests or linters configured in this project.

## Environment Variables

Create a `.env` file (gitignored) with:

```
DATABASE_URL=postgresql://user:password@host/dbname
SESSION_SECRET=your-secret-here
PORT=3000
NODE_ENV=development
```

If `SESSION_SECRET` is omitted, the server falls back to `'care-facility-secret-2024'`. The database tables and demo seed users are created automatically on first startup.

**Demo seed users (PIN = password):**
- 長男 PIN: 1111 (role: family)
- 次男 PIN: 2222 (role: family)
- 長女 PIN: 3333 (role: family)
- ケアマネージャー PIN: 9999 (role: caregiver)

## Architecture

### File Layout

The app is intentionally kept minimal with no build step:

- **`server.js`** — All Express routes and business logic (~314 lines)
- **`database.js`** — PostgreSQL connection pool and `CREATE TABLE IF NOT EXISTS` schema initialization
- **`public/index.html`** — Entire frontend: HTML + vanilla JS + Tailwind CSS via CDN (~938 lines)

### Backend (`server.js`)

RESTful JSON API built on Express. Key patterns:

- **Auth middleware**: `requireAuth()` blocks unauthenticated requests; `requireFamily()` additionally blocks `caregiver` role users
- **Raw SQL**: All queries use `pg` parameterized queries directly (no ORM)
- **Session-based auth**: `express-session` stores `userId` and `userRole` after PIN login
- **AI endpoint**: `POST /api/assistant` calls Anthropic SDK with `extended-thinking` budget; the Claude model is `claude-opus-4-5` with `betas: ['interleaved-thinking-2025-05-14']`

API route conventions:
- `/api/facilities` — CRUD for facilities (family-only write)
- `/api/facilities/:id/evaluations` — Star ratings per item per user
- `/api/facilities/:id/comments` — Comment threads
- `/api/vitals` — Health records scoped to the authenticated user
- `/api/assistant` — AI secretary (Claude API proxy)

### Frontend (`public/index.html`)

Single-page application using vanilla JS with manual view switching. Key patterns:

- **View switching**: `document.getElementById('someView').classList.add/remove('hidden')`
- **Global state**: `currentUser`, `currentFacilityId`, `facilities[]`, `pendingEvals{}`, `assistantChatHistory[]`
- **API layer**: `apiFetch(url, options)` — wraps `fetch()`, sets JSON headers, throws on non-OK responses
- **Rendering**: DOM manipulation via `.innerHTML` with template literal strings
- **Event handlers**: Inline `onclick="functionName()"` attributes in HTML

### Database Schema

Tables auto-created in `database.js`:

| Table | Key columns |
|---|---|
| `users` | `id`, `name`, `pin` (bcrypt), `role` ('family'│'caregiver') |
| `facilities` | `id`, `name`, `address`, `phone`, `visit_date`, `facility_type`, `created_by` |
| `evaluations` | `facility_id`, `user_id`, `item_key`, `rating` (1–5), `note` — unique on `(facility_id, user_id, item_key)` |
| `comments` | `facility_id`, `user_id`, `body`, `created_at` |
| `vitals` | `user_id`, `recorded_date`, `temperature`, `bp_systolic`, `bp_diastolic`, `pulse`, `spo2`, `weight` |

### Role-Based Access

- **family**: Full CRUD on facilities, evaluations, comments, vitals, and AI assistant
- **caregiver**: Read-only; blocked from all write operations by `requireFamily()` middleware

## Key Conventions

- **Language**: All UI text is in Japanese
- **Naming**: camelCase for JS identifiers; snake_case for SQL columns
- **Timestamps**: Stored as TEXT strings (ISO format), not native SQL timestamps
- **Dates**: `visit_date` stored as ISO date string
- **No build step**: Adding new frontend JS means editing `public/index.html` directly
- **No module system on frontend**: All frontend code is in one `<script>` block; use global functions and variables
