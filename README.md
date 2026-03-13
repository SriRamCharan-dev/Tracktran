# Tracktern

Tracktern is an AI-assisted internship intelligence platform that helps students discover, evaluate, organize, and act on opportunities faster. It combines resume analysis, opportunity parsing, authenticity checks, deadline tracking, and application-status analytics in a single dashboard.

## Live Deployment

https://tracktran.onrender.com

## Project Overview

Tracktern is designed for students who apply to many internships across different platforms and often lose track of deadlines, fit, and progress. The app centralizes this process by:

- Building a profile from resume text and detected skills.
- Parsing opportunity messages and links into structured records.
- Scoring authenticity and candidate-opportunity match.
- Prioritizing opportunities based on urgency and relevance.
- Tracking application status from Applied to Offer.
- Surfacing analytics to improve application strategy.

## Core Features

### 1. Authentication and Session Management

- Register, login, logout flows.
- Password hashing with bcryptjs.
- Session persistence through express-session and connect-mongo.
- Secure cookie and request hardening headers in app middleware.

### 2. Resume Intelligence

- Resume text upload and normalization.
- Skill extraction via heuristics and optional LLM enrichment.
- Resume score generation with strengths, weaknesses, and suggestions.
- Suggested bullet improvements for stronger resume impact.
- Profile-level role suggestions (AI-first, static fallback).

### 3. Opportunity Parsing and Enrichment

- Accepts raw opportunity text and optional source link.
- Uses Gemini (when configured) to extract structured data:
	company, role, required skills, eligibility, deadline, application link.
- Falls back to rule-based extraction when AI response is missing/invalid.
- Fetches and parses link context to improve extraction confidence.

### 4. Authenticity and Risk Scoring

- Scores opportunities based on:
	direct link presence, HTTPS usage, trusted host matching, and content completeness.
- Detects suspicious phrases (fees, urgency pressure, off-platform contact cues).
- Produces a score and explanation string for dashboard transparency.

### 5. Match Scoring and Prioritization

- Compares required skills against user profile and resume-detected skills.
- Computes match score and labels (Low, Medium, High).
- Derives missing skills and recommended improvements.
- Calculates urgency using parsed deadlines and flags critical items.

### 6. Deadline and Calendar Support

- Normalizes deadline formats (12-hour and 24-hour variants).
- Detects implicit deadline signals in text.
- Generates one-click Google Calendar event links with enriched event details.

### 7. Status Tracking and Dashboard Analytics

- Per-opportunity status transitions: Applied, Interview, Rejected, Offer.
- Status history timeline with notes.
- Dashboard metrics for totals, high-match opportunities, and near deadlines.
- Chart-ready distributions (status, category, monthly applications, skills).

### 8. Telegram Intake (Optional)

- Optional long-polling Telegram bot flow for opportunity intake.
- Supports both command-based and plain-text opportunity ingestion.
- Includes duplicate detection and fallback extraction.
- Polling can be controlled via environment flags for safe deployments.

## High-Level Architecture

- Runtime: Node.js + Express + EJS views.
- Persistence: MongoDB (Atlas preferred) via Mongoose models.
- Session store: Mongo-backed sessions with in-memory fallback when needed.
- AI integration: @google/genai (Gemini) with safe fallbacks to deterministic parsers.
- Deploy targets:
	- Render for persistent web service runtime.
	- Vercel serverless adapter through api/index.js and vercel.json rewrites.

## Main Application Routes

- Auth
	- GET /register
	- POST /register
	- GET /login
	- POST /login
	- GET /logout
	- POST /logout
- Profile and Resume
	- GET /profile
	- GET /upload-resume
	- POST /upload-resume
- Opportunities and Dashboard
	- GET /dashboard
	- POST /parse-opportunity
	- POST /update-opportunity-status/:id
	- POST /delete-opportunity/:id

## Data Model Summary

- User
	- identity (name, email, password hash)
	- profile metadata (branch, year, skills)
	- resume analysis object (score, insights, skills, improvements)
- Opportunity
	- ownership, company, role, eligibility
	- required skills, category
	- deadline and deadline mention metadata
	- authenticity score and reason
	- application status and status history

## Project Structure

```text
config/        Database configuration
lib/           Shared utilities (deadline parsing, calendar links)
models/        Mongoose schemas
routes/        Route handlers (auth, resume, opportunity)
views/         EJS templates
public/        Static frontend assets
api/           Serverless entrypoint for Vercel
__tests__/     Unit and integration tests
server.js      Process bootstrap
server-app.js  Express app factory
telegramBot.js Optional Telegram ingestion workflow
```

## Tech Stack

- Backend: Express 5, Node.js
- Database: MongoDB + Mongoose
- Sessions: express-session + connect-mongo
- Views/UI: EJS + custom CSS + Chart.js
- AI: @google/genai (Gemini)
- Messaging: node-telegram-bot-api
- Testing: Jest + Supertest + mongodb-memory-server

## Local Development

### Prerequisites

- Node.js 18+
- npm
- MongoDB Atlas URI (recommended) or local MongoDB

### Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment file from template:

```bash
cp .env.example .env
```

3. Run the app:

```bash
npm run dev
```

4. Open:

```text
http://localhost:3000
```

If your local workspace stores source files under a Code directory, run these commands from that directory.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| MONGODB_ATLAS_URI | Yes (production) | MongoDB Atlas connection string |
| MONGO_URI | Optional | Local Mongo fallback URI |
| SESSION_SECRET | Yes | Session signing secret |
| LLM_API_KEY | Recommended | Gemini/LLM API key for extraction and analysis |
| GEMINI_API_KEY | Optional | Alternate key name used by some routes |
| PORT | Optional | HTTP port (default 3000) |
| ENABLE_TELEGRAM_BOT | Optional | true/false to control polling bot startup |
| TELEGRAM_BOT_TOKEN | Optional | Required only when Telegram bot is enabled |
| NODE_ENV | Optional | environment mode (test/production/development) |

## Testing

Run all tests:

```bash
npm test
```

Run unit tests:

```bash
npm run test:unit
```

Run integration tests:

```bash
npm run test:integration
```

Run coverage:

```bash
npm run test:coverage
```

Test suite includes:

- Deadline parsing and normalization
- Google Calendar link generation
- Helper function behavior
- Resume analysis logic
- End-to-end route integration flow

## Deployment Notes

- Live instance is available on Render at:
	https://tracktran.onrender.com
- For persistent Telegram polling, deploy on a long-running host and control polling with ENABLE_TELEGRAM_BOT.
- On Vercel, requests are routed through api/index.js (serverless adapter), and polling is automatically avoided.

## Future Enhancements

- Background refresh jobs for stale opportunities
- Multi-user collaboration and shared shortlists
- Richer recruiter/company trust signals
- Exportable application reports and reminders