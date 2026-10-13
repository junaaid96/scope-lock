# ScopeLock

> A shared system of record for client scope, change requests, approvals, and delivery evidence.

ScopeLock answers four questions without searching through email, chat, and meeting notes:

1. What did we agree to deliver? (**Scope Ledger** — versioned requirements)
2. What has changed since that agreement? (**Change requests + agreement diff**)
3. Who approved each change, and when? (**Client decision inbox + audit trail**)
4. What does the change do to price, effort, and delivery date? (**Impact preview**)

The full product and technical blueprint lives in
[plan/ScopeLock_Product_and_Technical_Development_Plan.md](plan/ScopeLock_Product_and_Technical_Development_Plan.md).
Operator runbooks (secrets, AI data flow, backups, retention, vulnerability
management) live in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Monorepo layout

```text
scopelock/
├── apps/
│   ├── web/                 # React 18 + Vite + Tailwind client
│   └── api/                 # Express API (the only authority for business ops)
├── packages/
│   ├── contracts/           # shared Zod schemas / typed API contracts
│   ├── domain/              # pure domain rules (transitions, diff, policy, money…)
│   └── config/              # shared ESLint / TS presets
├── prisma/
│   ├── schema.prisma        # PostgreSQL schema (Neon in production)
│   ├── migrations/          # committed, CI-validated migrations
│   └── seed.ts              # local demo seed
├── docs/                    # operations + pilot flow notes
└── .env.example             # every supported variable (no real secrets)
```

Within `apps/api/src`, code is organized by domain module (`auth`,
`organizations`, `projects`, `scope`, `changes`, `approvals`, `files`,
`notifications`, `activity`, `ai`, …). Each module owns its routes, request
schemas, services, policy checks, and tests.

## Prerequisites

- Node.js ≥ 22 and npm
- PostgreSQL 16+ for production-like runs (optional locally — see below)
- No provider accounts are needed for local development: storage, email,
  realtime, and AI all have local/log fallbacks.

## Quickstart (local, zero dependencies)

```bash
npm install            # also builds shared packages + generates the Prisma client
cp .env.example .env   # defaults work out of the box (file-backed storage)

# Terminal 1 — API on http://localhost:4000
npm run dev:api

# Terminal 2 — web app on http://localhost:5173
npm run dev:web
```

Open http://localhost:5173, register an account (this creates your workspace),
and follow the pilot loop: create a client → create a project → publish a
scope baseline → submit a change → assess impact → send for approval → decide
from the review link.

To load a demo workspace instead:

```bash
npm run seed           # uses DATA_FILE (or DATABASE_URL when set to postgres)
```

### Storage modes

| `DATABASE_URL` / `DATA_FILE` | Backend | Use |
| --- | --- | --- |
| `DATABASE_URL=postgres://…` | PostgreSQL via Prisma | production, CI postgres job |
| `DATA_FILE=./data/scopelock.json` (default) | JSON file store | local development |
| `DATA_FILE=:memory:` | in-memory store | tests, Playwright, throwaway runs |

File-backed and in-memory modes implement the same `Store` interface as
PostgreSQL, including transactions with rollback.

### Production-like run with Postgres

```bash
createdb scopelock
DATABASE_URL=postgresql://localhost:5432/scopelock npx prisma migrate deploy
DATABASE_URL=postgresql://localhost:5432/scopelock AUTH_SECRET=$(openssl rand -hex 32) \
  WEB_URL=https://app.example.com API_URL=https://api.example.com \
  NODE_ENV=production npm run dev:api
```

Production refuses to boot without a ≥32-char `AUTH_SECRET`, a `DATABASE_URL`,
and non-localhost `WEB_URL`/`API_URL`/`AUTH_URL`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev:api` / `npm run dev:web` | hot-reload API / web client |
| `npm run build` | packages → API → web production builds |
| `npm run typecheck` | `tsc --noEmit` for every workspace (incl. API tests) |
| `npm run lint` | ESLint with zero-warning tolerance |
| `npm run test` | domain unit tests + full API integration suite |
| `npm run test:contracts` | API contract suite (envelopes + pagination) |
| `npm run e2e` | Playwright pilot loop + accessibility specs |
| `npm run seed` | demo workspace seed |
| `npm run prisma:validate` | Prisma schema validation |
| `TEST_DATABASE_URL=… npx vitest run tests/prisma-smoke.test.ts` (in `apps/api`) | live-Postgres migration + store smoke test |

## Environment variables

See [.env.example](.env.example) for the complete list. Highlights:

- `AUTH_SECRET` — session/token signing (≥32 chars in production; random per
  process in dev/test when empty)
- `GROQ_API_KEY` / `GROQ_MODEL` (`openai/gpt-oss-120b`) — server-only AI;
  empty key = deterministic fallbacks, manual workflow unaffected
- `AI_ENABLED` — global kill switch; organizations and projects can also opt out
- `R2_*` — Cloudflare R2 object storage; unset = local signed-URL driver
- `ABLY_API_KEY` — realtime fan-out; unset = REST polling stays correct
- `EMAIL_API_KEY` + `EMAIL_FROM` — transactional email; unset = log driver
- `MALWARE_SCANNER_URL` — optional ClamAV-style webhook for uploads
- `PENDING_UPLOAD_TTL_HOURS` (24) / `DELETED_FILE_PURGE_DAYS` (30) — retention
- `RATE_LIMIT_DISABLED=1`, `OUTBOX_AUTODRAIN=false` — test/CI conveniences

Never put secrets in `VITE_*` variables — the browser bundle must not contain
credentials (enforced by a security regression test).

## Architecture rules (enforced in code)

1. The Express API is the only authority for business operations and
   authorization. React never touches the database or provider credentials.
2. PostgreSQL owns business state; R2 holds bytes; Ably carries transient
   update events only.
3. Every protected action checks organization membership, project access, and
   the required role server-side (`http/access.ts` + `domain/policy.ts`).
4. Publish, decision, and send operations commit inside database transactions
   together with their audit and outbox entries.
5. AI output is untrusted draft data: it cannot publish scope, send approvals,
   or override deterministic policy. Invented requirement IDs are rejected.
6. External side effects (email, realtime) go through an outbox table with
   retried, idempotent delivery — a provider outage cannot corrupt a completed
   domain operation.

## Testing strategy

| Layer | Location | Focus |
| --- | --- | --- |
| Unit | `packages/domain/tests` | transitions, diff, checksum, health, money, policy |
| API integration | `apps/api/tests` | tenant scoping, atomic workflows, presigned-URL authz |
| Contract | `apps/api/tests/contract.test.ts` | error envelope + cursor pagination consistency |
| E2E | `apps/web/e2e/pilot-loop.spec.ts` | register → baseline → change → approval → decision |
| Security regression | `apps/api/tests/security.test.ts` | IDOR, token expiry/reuse, CSRF, secret leaks |
| AI evaluation | `apps/api/tests/ai.test.ts` | invented-ID rejection, fallback, injection resistance |
| Accessibility | `apps/web/e2e/a11y.spec.ts` | axe scans (serious/critical) on login + dashboard |
| Postgres smoke | `apps/api/tests/prisma-smoke.test.ts` | migrations apply; PrismaStore round-trips (CI + `TEST_DATABASE_URL`) |

CI runs typecheck, lint, unit + API tests, contract tests, migration
validation with drift detection against a fresh Postgres, the Postgres smoke
test, a production build, the full Playwright suite, and an advisory
vulnerability scan.

## Security model

- Sessions: `HttpOnly`, `SameSite=Lax`, `Secure`-in-production cookies;
  logout and password change invalidate sessions; CSRF origin/referer checks
  on cookie-authenticated mutations (missing origin rejected in production).
- Passwords hashed with scrypt; TOTP multi-factor authentication with sealed
  secrets and single-use recovery codes (owners/admins should enable it).
- Uploads: type/size allowlists, per-plan quotas, SHA-256 integrity,
  EICAR + executable-magic heuristics, optional external scanner, quarantine
  on verdict; downloads via 15-minute signed URLs; private buckets only.
- Approval review links are high-entropy, expiring, revocable, bound to an
  immutable package checksum, rate-limited, and fully audited.
- Audit history is append-only; account deletion deactivates the login while
  preserving the audit trail (see `docs/OPERATIONS.md` for PII hard-delete).

## Metrics & health

- `GET /api/v1/projects/:id/health` — explained scope-health signals (aging
  requests, pending/expired approvals, unlinked work, unapproved
  implementation), never a black-box score.
- `GET /api/v1/projects/:id/metrics` — §17 product metrics incl. decision
  quality and AI suggestion acceptance.
- `GET /api/v1/organizations/:id/metrics` — weekly active projects.
- `/healthz` / `/readyz` — liveness and storage readiness probes.
