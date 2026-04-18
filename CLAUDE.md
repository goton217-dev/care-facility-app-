# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

見守りノート ("Care Watching Note") is a Japanese-language web application for comparing and evaluating senior care facilities (介護施設). It supports multi-user collaboration between family members and care managers, health vitals tracking, and an AI-powered advisory assistant.

## Commands

```bash
# Start the server (runs on port 3000)
npm start

# Install dependencies
npm install
```

There is no build step, test suite, or linter configured. The frontend is a static single HTML file served by Express.

## Required Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | *(none)* | PostgreSQL connection string — required |
| `PORT` | `3000` | HTTP listen port |
| `SESSION_SECRET` | `care-facility-secret-2024` | Override in production |
| `NODE_ENV` | — | Set to `production` to enable PostgreSQL SSL |

## Architecture

### Stack
- **Backend:** Node.js + Express 4, PostgreSQL (`pg`), `express-session`, `bcryptjs`
- **Frontend:** Single HTML file (`public/index.html`) — vanilla JS + Tailwind CSS via CDN, no framework or build tool
- **AI:** `@anthropic-ai/sdk` — Claude `claude-opus-4-7` with extended thinking enabled

### Two-file backend

| File | Role |
|---|---|
| `server.js` | All Express routes, middleware, and auth logic |
| `database.js` | Schema creation (`initDB()`), PostgreSQL pool configuration |

### Database schema (5 tables)

- **users** — login accounts with bcrypt PIN and role (`family` or `caregiver`)
- **facilities** — care facility records, linked to creator user
- **evaluations** — star ratings (1–5) per `(facility_id, user_id, item_key)`; uses UPSERT on `ON CONFLICT`
- **comments** — threaded notes on facilities
- **vitals** — daily health records (temperature, BP, pulse, SpO₂, weight)

### Frontend SPA pattern

`public/index.html` is a ~940-line self-contained SPA. Navigation works by showing/hiding `<div>` sections via JavaScript (`showList()`, `showDetail()`, `showAddFacility()`, etc.). Global state lives in top-level JS variables: `currentUser`, `currentFacilityId`, `facilities`. All API calls go through the `apiFetch()` helper.

### Auth

Session-based via `express-session`. Two middleware helpers guard routes:
- `requireAuth()` — any logged-in user
- `requireFamily()` — role must be `family`

### AI assistant

`POST /api/assistant` accepts a conversation history array and the current facility context. The handler calls Claude with adaptive thinking (`budget_tokens: 10000`) and streams back a response. History is capped at 20 messages.

### Evaluation criteria (12 fixed keys)

```
insulin, monthly_fee, initial_fee, insurance_extra, atmosphere,
staff, vacancy, medical, meal, outing, care_manager, move_out
```

These keys are hardcoded in both backend SQL and frontend JS — changing them requires updating both files and any existing database rows.

### Seed / test data

`careapp.json` (git-ignored) holds seed data loaded by `initDB()`. Default test users:

| Name | Role | PIN |
|---|---|---|
| 長男 | family | 1111 |
| 次男 | family | 2222 |
| 長女 | family | 3333 |
| ケアマネージャー | caregiver | 9999 |

## Conventions

- All UI strings and domain entity names are in Japanese — keep additions consistent.
- Timestamps use `toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })`.
- SQL uses positional parameters (`$1`, `$2`, …) — never string interpolation in queries.
- Frontend HTML output must go through `escHtml()` to prevent XSS.
- Backend routes follow the pattern: parse `req.session.user` for identity, query DB with `await pool.query(...)`, return `res.json(...)`.
