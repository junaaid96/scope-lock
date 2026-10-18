# ScopeLock Operations Guide

Runbook for deploying, configuring, and operating ScopeLock. Developer setup
lives in [README.md](../README.md); product direction lives in
[plan/ScopeLock_Product_and_Technical_Development_Plan.md](../plan/ScopeLock_Product_and_Technical_Development_Plan.md).

## 1. Secrets & environments

- Keep one `.env` per environment, never in Git (`.env`, `.env.*.local` are
  gitignored). Production secrets live in the hosting provider's encrypted
  secret manager.
- Use separate secrets and databases for development, staging, and production.
- Required in production (`NODE_ENV=production` refuses to boot without them):
  `AUTH_SECRET` (≥32 chars), `DATABASE_URL`, and non-localhost `WEB_URL`,
  `API_URL`, `AUTH_URL`.
- Server-only credentials (never in the browser bundle, never logged):
  `AUTH_SECRET`, `GROQ_API_KEY`, `R2_*`, `ABLY_API_KEY`, `EMAIL_API_KEY`.
  Short-lived R2/Ably URLs and tokens are minted by the API after an
  authorization check.
- Rotate any secret after suspected exposure. The logger redacts
  token/secret/url/prompt-bearing keys; session tokens, signed URLs, raw
  prompts, and document contents must never be logged.

## 2. AI provider data flow

Providers: Groq API (default model `openai/gpt-oss-120b`) and OpenAI
(`gpt-4o-mini`), called **only** from `apps/api/src/modules/ai/`
(server-side). `AI_PROVIDER` selects the primary; when it fails, the other
configured provider serves the request and the usage log records who served.

What is sent per capability (minimum authorized text only):

| Capability | Prompt contents |
| --- | --- |
| Requirement extraction | pasted proposal excerpt + source label |
| Scope-drift analysis | change title/description + governing requirement IDs/titles/descriptions (≤800 chars each) |
| Clarification questions | change title/description |
| Proposal draft | change text + recorded impact fields (price, effort, dates, risks) |
| Decision memory | question + last 20 decision summaries of that project |
| Agreement comparison | the two versions' requirement texts |

Controls:

- Access checks run **before** any prompt is assembled; only records the caller
  may read enter the prompt. Attachment bytes and unrelated projects are never
  included.
- Structured JSON outputs are Zod-validated; malformed output and invented
  requirement IDs are rejected (`droppedInventedIds` is recorded).
- Every call stores provider, model, prompt-template version, source record
  IDs, latency, outcome, and reviewer disposition — not secrets or retained
  raw sensitive content. Review dispositions feed the AI acceptance metric.
- Timeouts (10s scanner-style budget on provider calls) + retry on safe
  transient failures only; rate-limited (`ai` group: 30/min) and
  quota-counted per plan.
- No configured provider (or `AI_ENABLED=false`, or org/project opt-out)
  falls back to deterministic results; the manual workflow is always
  available.
- Quoted project text is framed as data (`DATA ONLY`), and injection-like
  fixtures are covered in `apps/api/tests/ai.test.ts`.

Opt-out precedence: `AI_ENABLED=false` > organization `aiEnabled=false` >
project `settings.aiEnabled=false`.

## 3. Email

- Set `EMAIL_API_KEY` + `EMAIL_FROM` (+ `EMAIL_HTTP_ENDPOINT`,
  `https://api.resend.com/emails` by default in `.env.example`) for the HTTP
  driver; otherwise the log driver records what would have been sent (safe
  for dev/test).
- All email goes through the outbox: `EMAIL` rows are written inside the
  domain transaction and delivered by the worker with backoff (8 attempts,
  then dead-lettered). `Idempotency-Key`-style `idempotencyKey` values on
  reminders/expiry notices suppress duplicates.
- Payload shape per outbox row: `{ to, subject, text, organizationId?,
  projectId?, notificationType? }`. Usage counts `emailsSent` per org/period.

### Inbound email

- Each project gets unguessable aliases (`chg-<96-bit hex>@INBOUND_EMAIL_DOMAIN`),
  managed from the project Intake tab (staff only).
- Any provider works: forward delivery events to
  `POST /api/v1/webhooks/inbound-email` in the `InboundEmailSchema` shape with
  header `x-inbound-signature: t=<unix>,v1=<hmac-sha256(t + "." + rawBody)>`
  using `INBOUND_EMAIL_WEBHOOK_SECRET`. Timestamps older than 5 minutes are
  rejected (410); provider `messageId`s dedupe retries for 24h.
- Unknown aliases are dropped + logged (200, no leak); auto-replies/loops are
  detected via headers + subject backstop and dropped; quoted history and
  signatures are stripped; attachments (≤5 MB each, inline base64) ride the
  standard upload + malware pipeline before linking. Surviving mail becomes a
  SUBMITTED `INBOUND_EMAIL` change flagged “unverified submitter”.
- Local dev: `POST /api/v1/dev/simulate-inbound-email` (staff auth, never in
  production) runs the same ingest without a signature — see the Intake tab
  “Simulate email…” button.

## 4. Storage (R2 / local)

- Set all of `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET_NAME` (plus optional `R2_ENDPOINT`) to use Cloudflare R2 via the
  S3-compatible SDK. Otherwise the local driver stores bytes under
  `UPLOAD_DIR` and serves them only through signed API endpoints (never
  statically, no bucket listing either way).
- Presigned upload/download URLs live 15 minutes and are single-purpose.
- Type allowlist (pdf, text, images, zip, json, office docs), per-plan byte
  quotas, and SHA-256 integrity checks run before completion.
- Malware strategy (`apps/api/src/lib/scan.ts`): local bytes are inspected
  for the EICAR test signature and executable magic bytes; set
  `MALWARE_SCANNER_URL` to also consult an external scanner
  (`POST {sha256,sizeBytes,contentType}` or `{bucket,key}` →
  `{"verdict":"CLEAN"|"INFECTED"}`, 10s timeout, fails closed). Flagged
  uploads become `QUARANTINED` (never downloadable) with an audit record.
  R2 uploads without a configured scanner complete as `SKIPPED` with a log
  warning — configure a scanner before broad R2 use.

## 5. Realtime (Ably)

- Set `ABLY_API_KEY` to publish fan-out events; the API mints subscribe-only
  channel tokens after authorization (`project:{id}` / `user:{id}`).
- Events carry refresh hints (`title`, `link`), never record contents beyond
  what the viewer may read. With no key, the web app polls/refreshes over
  REST and stays correct — realtime is never a correctness dependency.

## 6. Retention & lifecycle

Enforced by the worker (`drainOnce`, every 15s on servers, `OUTBOX_AUTODRAIN`
to disable):

| Data | Policy | Knobs |
| --- | --- | --- |
| Abandoned `PENDING` upload intents | bytes removed, metadata → `DELETED`, audited | `PENDING_UPLOAD_TTL_HOURS` (24) |
| `DELETED` attachment bytes | bytes purged, metadata kept for the audit trail | `DELETED_FILE_PURGE_DAYS` (30) |
| `READY` files | **never auto-deleted** | — |
| Approval review tokens | expire per package `expiresAt`; expired packages transition to `EXPIRED` with notices | per-send |
| Outbox rows | `SENT` kept; `FAILED` retried with backoff; `DEAD` after 8 attempts for inspection | — |
| Audit events | append-only, retained; see §9 for PII handling | — |

## 7. Backups & restore

- **Postgres (Neon):** enable point-in-time recovery / branching on the
  project; take a manual snapshot before migrations. Restore rehearsal:
  `prisma migrate deploy` against a fresh branch, run the smoke test
  (`TEST_DATABASE_URL=… npx vitest run tests/prisma-smoke.test.ts` from
  `apps/api`), then promote.
- **File mode:** back up `DATA_FILE` and `UPLOAD_DIR` together (they are only
  consistent as a pair). The file store writes atomically; restore by stopping
  the API, replacing both, restarting.
- **Compose self-host:** back up the `pgdata` and `uploads` volumes together
  (`docker run --rm -v scopelock_pgdata:/pg -v scopelock_uploads:/up -v
  $(pwd):/out alpine tar czf /out/scopelock-backup.tgz /pg /up`). Restore by
  stopping the stack (`docker compose down`), restoring both volumes, and
  starting again.
- **R2:** enable bucket versioning; lifecycle rules should mirror §6 (delete
  markers for expired intents are safe; never auto-expire `READY` keys).
- Verify backups monthly: restore to scratch, boot the API with
  `DATABASE_URL`/`DATA_FILE` pointed at the copy, and confirm `/readyz` plus
  one login.

## 8. Migrations

- `prisma migrate deploy` on every deploy (CI proves it applies to a fresh
  database and that the migrated schema matches `schema.prisma` exactly).
- Never edit an applied migration; add a new one. Regenerate the client
  (`npm run prisma:generate`) after schema changes.
- The API also ships file/in-memory stores implementing the same interface
  for local dev and tests; they need no migrations.

## 9. Accounts, MFA & PII requests

- Owners/admins should enable TOTP MFA (workspace settings → sign-in
  security). Secrets are AES-256-GCM-sealed with a key derived from
  `AUTH_SECRET`; recovery codes are single-use and stored hashed.
- `GET /api/v1/auth/me/export` returns a portable copy of identity,
  memberships, project roles, and notifications for data-portability requests.
- `DELETE /api/v1/auth/me` (password-confirmed) deactivates the login,
  clears sessions/MFA, and preserves the audit trail with the actor's email.
  For hard PII erasure after retention review, an operator nulls
  `User.name`/`email` (to `deleted+{id}@example.invalid` / "Deleted user") and
  `actorEmail` on that user's audit rows directly in the database, then
  records the erasure in the support log. Seek legal advice before making
  compliance claims for your market.
- ScopeLock records are operational history, not legal contracts or e-signature
  evidence; do not present them as such without jurisdiction-specific review.

## 10. Rate limits & abuse signals

| Group | Limit | Applies to |
| --- | --- | --- |
| `default` | 600/min/IP | API + signed byte endpoints |
| `auth` | 30/min/IP | login, register, MFA, invitations |
| `token` | 60/min/IP | public review links + intake forms |
| `ai` | 30/min/IP | AI endpoints (also plan-quota'd) |

429s are logged with method/path/group only (no tokens). Review-link probing
returns 404/410 without disclosing package existence. Intake forms add a
honeypot field (fills are silently dropped and counted as `intake.honeypot`)
and land as SUBMITTED changes flagged “unverified submitter” — never trust the
self-declared contact. The in-memory limiter is single-process — put a shared
store or edge limiter in front for multi-instance deployments.

## 11. Monitoring

- Probes: `GET /healthz` (liveness), `GET /readyz` (storage readiness).
- Structured JSON logs carry `correlationId` (also returned as
  `X-Request-Id` and stored on audit rows); API errors return safe messages
  plus the correlation ID for support lookup.
- Watch: worker `dead` outbox rows, approval delivery failures, AI errors,
  429 spikes, GC purge counts, and API latency. Set `SENTRY_DSN` for error
  monitoring before paid pilots.

## 12. Dependency & vulnerability management

- CI runs `npm audit --omit=dev --audit-level=high` as an advisory scan on
  every push/PR. Triage new findings weekly; `npm audit fix` for safe
  upgrades, scheduled minor/major bumps for the rest.
- Known accepted risk (2026-10): transitive `fast-xml-parser ≤5.6.0`/
  `@smithy` advisories reachable only via the AWS SDK's R2 response parsing
  (never user-supplied XML). Re-evaluate on every AWS SDK upgrade; no
  mitigation needed for local-storage deployments.
- Rehearse restore (§7) and review this guide before each pilot expansion.
