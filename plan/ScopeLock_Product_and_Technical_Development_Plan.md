# ScopeLock — Product & Technical Development Plan

> **A shared system of record for client scope, change requests, approvals, and delivery evidence.**

**Document purpose:** This is the implementation blueprint for an MVP and its next releases. It consolidates the product direction, technology choices, architecture, data model, API shape, epics, user stories, acceptance criteria, security rules, and delivery sequence for ScopeLock.

> **Implementation status (synced 2026-10-18):** the MVP loop plus expansion **Phases 0–3 and #16–#17 are shipped**; **#18 (notification channels) is in progress**; Phases 5–6 are pending. §21 logs every expansion feature with its branch and status. Earlier sections keep the original blueprint wording except where marked **[Updated]** to reflect shipped reality.

---

## 1. Product vision

ScopeLock helps freelance developers, software agencies, design studios, and consultancies answer four questions without searching through email, chat, proposals, and meeting notes:

1. What did we agree to deliver?
2. What has changed since that agreement?
3. Who approved each change, and when?
4. What does the change do to price, effort, and delivery date?

ScopeLock is **not** a replacement for Jira, Linear, Trello, GitHub, or a general client portal. It manages the boundary between the agreed scope and newly requested work. Its source of truth is a versioned **Scope Ledger**: an auditable record of requirements, changes, decisions, and delivery evidence.

### Initial target customer

- Primary: freelancers and software agencies with 1–30 people serving multiple clients.
- Secondary: web/design studios and technical consultancies selling defined project work.
- Initial project type: fixed-price or milestone-based software projects. Expand to other services only after validating this workflow.

### Core job to be done

> When a client asks for work after the project begins, help my team determine whether it is already included, communicate the impact clearly, and obtain a durable decision before we start.

### Product principles

- **Evidence over memory.** Link decisions to requirements, versions, and attachments.
- **Human authority over AI.** AI may suggest; authorized people approve, reject, and publish.
- **Append-only history for consequential actions.** Never silently rewrite an approved agreement or approval.
- **Useful alongside existing tools.** ScopeLock owns scope decisions, not task execution.
- **Trust before automation.** Make every change understandable and reviewable.

---

## 2. Differentiation and MVP position

| Differentiator | Customer value | MVP status |
| --- | --- | --- |
| **Scope Ledger** | A requirement-level, versioned record of what was agreed | P0 |
| **Scope Drift Detector** | Flags new requests that may be outside the approved scope, with linked evidence | P0 (rules), P1 (AI) |
| **Impact Preview** | Shows proposed price, effort, milestone, and date effects before approval | P0 |
| **Client Decision Inbox** | One calm, client-friendly place to approve, reject, or request clarification | P0 |
| **Agreement Diff** | Makes additions, removals, and edits between approved versions legible | P0 |
| **Decision Memory** | Preserves the rationale, not just the final answer | P1 |
| **Change Bundler** | Groups related requests into one coherent commercial decision | P1 |
| **Approval Dependencies** | Prevents a dependent decision from proceeding too early | P1 |
| **Delivery Evidence** | Connects completed scope to demos, links, test results, and files | P1 |
| **Scope Health** | Reveals pending decisions, unapproved work, and aging requests | P1 |

### MVP promise

For one agency and one client project, a team can create an approved scope, receive a new request, assess and price the impact, send it to the client, capture a decision, and preserve the complete audit trail.

### Explicit non-goals for the MVP

- Full task/project management, time tracking, invoicing, accounting, or e-signature compliance.
- Automatic contractual interpretation or automatic approval of work.
- Native integrations with every messaging or PM platform.
- Real-time collaborative document editing.
- Multi-currency tax calculation and subscription billing.

---

## 3. Free-tier-first operating approach

Build the validation MVP with provider free tiers or minimal usage, then introduce paid capacity only after customers prove the workflow is valuable. Free plans, usage caps, and model availability change; verify current provider terms before production deployment.

| Capability | Initial choice | Why / rule |
| --- | --- | --- |
| Web app | React + TypeScript + Vite | Fast local development and low-cost static hosting |
| API | Express.js + TypeScript | Simple modular monolith; one authoritative backend |
| Database | Neon PostgreSQL | Managed PostgreSQL suitable for early development |
| ORM | Prisma | Type-safe database access and migrations |
| UI | Tailwind CSS + shadcn/ui | Accessible building blocks without a bespoke design system first |
| AI | Groq API, `openai/gpt-oss-120b` | Server-side assistance only; add quotas and graceful fallback |
| File storage | Cloudflare R2, **only when uploads are needed** | Store private documents/evidence, not application records |
| Realtime | Ably, **only when live updates prove useful** | Notifications and refresh hints; PostgreSQL remains authoritative |
| Email | A transactional provider with a suitable starter allowance | Invitations, approval notices, reminders |
| Observability | Structured logs plus a starter error-monitoring plan | Add richer monitoring before paid pilots |

**[Updated]** Shipped reality: AI runs through an `AiProvider` abstraction with **Groq primary + OpenAI (`gpt-4o-mini`) failover** and deterministic fallbacks, behind `AI_ENABLED` plus org/project opt-outs. Email sends via a generic HTTP driver (Resend by default) with a log driver when unconfigured. Approval lifecycle events also fan out to **Slack** (org webhook), **SMS/WhatsApp** (provider interface, log driver locally) per user channel preferences — all through the outbox. Local dev needs zero provider accounts: file/memory stores, log drivers, and local simulators.

**Cost guardrails:** defer R2 until attachment upload is usable, defer Ably until polling/invalidation is insufficient, rate-limit and quota AI calls, resize/limit uploads, and give organization administrators usage visibility.

---

## 4. Recommended architecture

Start with a TypeScript modular monolith. The hard problems are domain modeling, authorization, versioning, and reliable workflows—not microservices.

```text
                         ┌─────────────────────────────┐
                         │ React + Vite web application │
                         │ Tailwind / shadcn/ui          │
                         └──────────────┬──────────────┘
                                        │ HTTPS / REST
                         ┌──────────────▼──────────────┐
                         │ Express API                  │
                         │ Auth · access control        │
                         │ Scope · changes · approvals  │
                         │ Audit · notifications        │
                         └───────┬────────────┬────────┘
                                 │            │
             ┌───────────────────▼───┐  ┌─────▼────────────────┐
             │ Prisma + Neon Postgres│  │ Optional integrations │
             │ authoritative records │  │ R2 · Ably · email    │
             └───────────────────────┘  └──────────┬───────────┘
                                                     │
                                           ┌─────────▼─────────┐
                                           │ Groq API          │
                                           │ gpt-oss-120b      │
                                           └───────────────────┘
```

### Architecture rules

1. The Express API is the only authority for business operations and authorization.
2. React never connects directly to Neon and never receives private R2, Ably, Groq, or email credentials.
3. PostgreSQL owns business state. R2 holds bytes and Ably carries transient delivery/update events.
4. Every protected action checks organization membership, project access, and required role.
5. Publish scope versions, resolve approvals, and write audit entries inside database transactions.
6. AI output is untrusted draft data. It cannot publish a scope version, create an approval, or override deterministic policy.
7. Use an outbox table for external notifications so a provider outage cannot corrupt a completed domain operation.

**[Updated]** Enforced in code as: `http/access.ts` + `domain/policy.ts` for every protected action; triad stores (Prisma + JSON file + in-memory) implementing one `Store` interface with committed migrations and drift checks; atomic publish/decision/send with audit + outbox rows; outbox-only side effects with local drivers; immutable versions/packages; hash-chained append-only audit; high-entropy expiring revocable tokens with rate limits on public endpoints; no secrets in `VITE_*`; no legal-advice copy; no task/time/invoicing/tax/payments scope.

### Suggested monorepo layout

```text
scopelock/
├── apps/
│   ├── web/                 # React + Vite client
│   └── api/                 # Express API
├── packages/
│   ├── contracts/           # shared Zod schemas / typed API contracts
│   ├── domain/              # pure domain rules and value objects
│   ├── config/              # ESLint, TypeScript, Tailwind presets
│   └── ui/                  # optional shared shadcn wrappers
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── docs/
└── .env.example
```

Within `apps/api/src`, organize by domain module, for example `auth`, `organizations`, `projects`, `scope`, `changes`, `approvals`, `files`, `notifications`, `audit`, and `ai`. Each module owns routes, request schemas, services, repositories, policy checks, and tests.

---

## 5. Technology decisions

| Area | Recommendation |
| --- | --- |
| Frontend | React, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Zod |
| UI | Tailwind CSS, shadcn/ui, accessible semantic HTML, responsive layouts |
| API | Express.js, TypeScript, Zod request validation, centralized error mapping |
| Persistence | Prisma with Neon PostgreSQL; pinned, production-supported dependency versions |
| Authentication | Use an authentication solution that supports secure sessions, invitation flow, password recovery/OAuth as needed. Keep authorization in the API. |
| Files | R2 via S3-compatible SDK; short-lived server-created presigned upload/download URLs |
| Realtime | Ably presence/events only after MVP; channel tokens are created by the API after authorization |
| AI | Groq SDK/API in a dedicated server module; default model `openai/gpt-oss-120b` |
| Tests | Vitest, Supertest, Playwright; test database or isolated Neon branch for integration tests |
| Delivery | CI runs typecheck, lint, tests, migration validation, and a production build before deploy |

---

## 6. Environment variables and secret handling

Create a local `.env` file for secrets and a committed `.env.example` file with empty, non-secret placeholders. Add `.env`, `.env.*.local`, and provider credential files to `.gitignore`. Never put secrets in React variables that are exposed at build time.

### `.env.example`

```dotenv
# Runtime
NODE_ENV=development
PORT=4000
WEB_URL=http://localhost:5173
API_URL=http://localhost:4000

# Database
DATABASE_URL=
DIRECT_URL=

# Authentication (adapt to the chosen provider)
AUTH_SECRET=
AUTH_URL=http://localhost:4000
AUTH_CLIENT_ID=
AUTH_CLIENT_SECRET=

# AI — server only
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b

# Object storage — only if uploads are enabled
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_ENDPOINT=

# Realtime — only if enabled; server secret, not a browser key
ABLY_API_KEY=

# Email / observability (optional for local development)
EMAIL_API_KEY=
EMAIL_FROM=
SENTRY_DSN=
```

**[Updated]** The committed `.env.example` additionally documents: `DATA_FILE` (zero-dependency local store), `SESSION_TTL_HOURS`, `OPENAI_API_KEY`/`OPENAI_MODEL`/`AI_PROVIDER`/`AI_ENABLED`, `UPLOAD_DIR`, `MALWARE_SCANNER_URL`, `PENDING_UPLOAD_TTL_HOURS`, `DELETED_FILE_PURGE_DAYS`, `EMAIL_HTTP_ENDPOINT`, `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_WEBHOOK_SECRET`, `DB_PASSWORD` (compose), `RATE_LIMIT_DISABLED`, `API_KEY_RATE_LIMIT_PER_MIN`, `OUTBOX_AUTODRAIN`, `SMS_API_URL`/`SMS_API_KEY`, `WHATSAPP_API_URL`/`WHATSAPP_API_KEY`.

### Mandatory safeguards

- Validate required environment values with Zod at API startup; fail closed in production.
- Use separate development, staging, and production secrets and databases.
- Store deployment secrets in the hosting provider’s encrypted secret manager, not source control.
- Rotate a secret after suspected exposure; do not log keys, session tokens, signed URLs, raw prompts, or document contents.
- Keep `GROQ_API_KEY`, R2 credentials, and the Ably root API key on the server only.
- If a browser needs R2 or Ably access, issue a short-lived, tightly scoped URL/token after an API authorization check.

---

## 7. Domain model and invariants

### Core entities

| Entity | Important fields / purpose |
| --- | --- |
| User | Identity, name, email, status |
| Organization | Agency/workspace, plan metadata, settings |
| Membership | `organizationId`, `userId`, role: `OWNER`, `ADMIN`, `MEMBER`, `CLIENT` |
| Client | Organization-owned customer/company record |
| Project | Client relationship, currency, status, access settings, baseline dates/budget |
| ProjectMember | Project-specific role and client/agency access |
| ScopeDocument | Named agreement container; holds draft/published versions |
| ScopeVersion | Immutable snapshot, sequence number, lifecycle (`DRAFT`, `PUBLISHED`, `SUPERSEDED`) |
| Requirement | Stable project requirement record with title, description, category, priority, acceptance criteria, status |
| RequirementRevision | Version-specific content linking a requirement to a scope version |
| ChangeRequest | Client/team request, submitter, source, description, lifecycle/status |
| ChangeImpact | Proposed cost, effort, date/milestone effect, risks, estimate confidence |
| ChangeLink | Links a request to requirements, other changes, and dependencies |
| ApprovalRequest | Review package sent to explicit approvers, expiration/reminder state |
| ApprovalDecision | Immutable approve/reject/request-changes decision, comment, timestamp, actor |
| DecisionNote | Rationale and context associated with a requirement/change/version |
| Attachment | R2 object metadata, checksum, owner, content type, retention/access state |
| DeliveryEvidence | Requirement-to-URL/file/demo/test evidence link and verifier state |
| AuditEvent | Append-only actor/action/target/before-after metadata/request correlation |
| Notification / OutboxEvent | User-visible delivery state and reliable external work queue |
| AIAnalysis | Input references, structured output, model, prompt version, status, reviewer disposition |

**[Updated]** Shipped entities added by the expansion (47 models, migrations `0001`–`0019`): `RateCard`/`RateCardEntry`, `EstimateTemplate`, `AllowancePool`/`AllowanceDrawDown`, `ChangeOption`, `StepUpChallenge`, `ApprovalToken`, `IntakeLink`, `InboundMailbox`, `Clarification`, `Bundle`, `AuditChainHead` (per-project hash-chain head), `MetricEvent`, `UsageCounter`, `IdempotencyRecord`, `ApiKey`, `WebhookSubscription`/`WebhookDelivery`, `ExternalConnection`/`ExternalWorkItem` (+ pre-existing `ExternalLink`), `Session`, `PasswordReset`, `Invitation`. `User` gained MFA (`totpSecretEnc`, recovery hashes), phone (`phoneE164`) and channel prefs (`notifyEmail/Sms/Whatsapp`); `Organization` gained `slackWebhookUrlSealed`; `Project` gained allowance/deemed/escalation settings and the external-integrations opt-in.

### Key relationships

```text
Organization ──< Membership >── User
Organization ──< Client ──< Project ──< ProjectMember >── User
Project ──< ScopeDocument ──< ScopeVersion ──< RequirementRevision >── Requirement
Project ──< ChangeRequest ──< ChangeImpact
ChangeRequest ──< ChangeLink >── Requirement / ChangeRequest
ChangeRequest ──< ApprovalRequest ──< ApprovalDecision
Project ──< Attachment / AuditEvent / DecisionNote / AIAnalysis
Requirement ──< DeliveryEvidence
```

### Required lifecycle rules

1. A published `ScopeVersion` is immutable. Corrections create a newer version, never an in-place edit.
2. A requirement can be updated in a draft, but a published requirement revision remains reconstructible forever.
3. A change can become `APPROVED` only through a recorded decision by an eligible approver.
4. Only an approved change may create or amend a published scope version; cancellation/rejection leaves the ledger unchanged.
5. Approval links are bound to a specific review-package checksum/version; material edits invalidate prior pending approval requests.
6. Deleting user-facing records is soft-delete or archival where legal/retention requirements allow; audit history remains protected.
7. Every state transition has an actor, time, prior state, resulting state, and correlation ID.

### Useful enums

```text
ProjectStatus: DRAFT | ACTIVE | PAUSED | COMPLETED | ARCHIVED
ChangeStatus: DRAFT | SUBMITTED | TRIAGING | NEEDS_CLARIFICATION |
              ESTIMATING | PENDING_APPROVAL | APPROVED | REJECTED |
              WITHDRAWN | IMPLEMENTED
ApprovalStatus: DRAFT | SENT | DECIDED | EXPIRED | INVALIDATED
RequirementStatus: PROPOSED | AGREED | IN_PROGRESS | DELIVERED | ACCEPTED | OUT_OF_SCOPE
```

**[Updated]** Shipped enums: `ChangeStatus` adds `PARKED`; `ApprovalStatus` adds `DEEMED` (policy-deemed acceptance); `OutboxType` is `EMAIL | REALTIME | WEBHOOK | SLACK | SMS | WHATSAPP`; `WebhookDeliveryStatus` is `PENDING | SENT | FAILED | DEAD`. New enums include `ChangeClassification`, `DecisionValue`, `LinkKind`/`LinkCondition`, `EvidenceType`/`Status`, `AttachmentStatus`, `Confidence`, `BundleStatus`, `AIKind`/`AIStatus`, `Plan`, `AllowanceKind`/`AllowancePoolStatus`/`DrawDownStatus`, `OrgRole`, `ProjectRole`.

---

## 8. Authorization model

| Role | Main permissions |
| --- | --- |
| Owner | Organization configuration, membership, all projects, exports |
| Admin | Manage organization projects, people, scopes, and approvals |
| Agency member | Access assigned projects; draft/manage scope and changes according to project role |
| Client admin | View assigned client projects; submit requests; invite client reviewers if granted |
| Client approver | View the specific project/review package; decide only when assigned |
| Client viewer | Read-only project visibility |

Do not rely solely on UI hiding. Each route resolves the authenticated user, organization, project, resource, and action against a server-side policy. Queries must always be scoped by organization/project access so IDs cannot be guessed across tenants.

---

## 9. REST API design

Use resource-oriented versioned endpoints (`/api/v1`). Validate every body, query, and path parameter with shared Zod contracts. Use standard error envelopes with a safe public message and a correlation ID.

| Area | Representative endpoints |
| --- | --- |
| Session | `GET /me`, `POST /auth/invitations/:token/accept` |
| Organizations | `GET/POST /organizations`, `GET/PATCH /organizations/:id`, `POST /organizations/:id/invitations` |
| Clients & projects | `GET/POST /clients`, `GET/POST /projects`, `GET/PATCH /projects/:id`, `POST /projects/:id/members` |
| Scope | `GET /projects/:id/scope-versions`, `POST /projects/:id/scope-versions/draft`, `PATCH /scope-versions/:id`, `POST /scope-versions/:id/publish`, `GET /scope-versions/:id/diff/:otherVersionId` |
| Requirements | `GET/POST /projects/:id/requirements`, `PATCH /requirements/:id`, `POST /requirements/:id/evidence` |
| Changes | `GET/POST /projects/:id/change-requests`, `GET/PATCH /change-requests/:id`, `POST /change-requests/:id/submit`, `POST /change-requests/:id/impact`, `POST /change-requests/:id/bundle` |
| Approvals | `POST /change-requests/:id/approval-requests`, `GET /approval-requests/:token`, `POST /approval-requests/:token/decisions` |
| Files | `POST /projects/:id/uploads/intents`, `POST /attachments/:id/complete`, `GET /attachments/:id/download-url` |
| AI | `POST /projects/:id/ai/extract-requirements`, `POST /change-requests/:id/ai/scope-analysis`, `POST /change-requests/:id/ai/clarifications`, `POST /change-requests/:id/ai/proposal-draft` |
| Activity | `GET /projects/:id/activity`, `GET /projects/:id/health`, `GET /notifications` |

**[Updated]** Shipped additions (all under `/api/v1`): contract ledger + invoice export (`ledger.ts`); rate cards/templates (`pricing.ts`); allowance pools/draw-downs/objections (`allowance.ts`); intake links + public form (`intake.ts`); inbound mailboxes + signed provider webhook + dev simulator (`inbound.ts`); approval policies/options/escalation + reminders (`approvals.ts`, `lifecycle.ts`); Change Order PDF + `/verify/:approvalId` certificate (`change-order.ts`); audit verify (`/projects/:id/audit/verify` + `npm run audit:verify`); API keys (`sk_`, scoped, rotatable, per-key limits); outgoing webhooks (HMAC, delivery log, replay); generated spec at `GET /api/openapi.json`; GitHub connections + signed receiver (`/webhooks/github/:connectionId`) + observed work; notification preferences + org Slack (#18, in progress). Review-link step-up (OTP + typed name) gates decisions per org/project policy.

### API behavior conventions

- Use cursor pagination on activity, notifications, and list pages.
- Use optimistic-concurrency/version fields on editable drafts to prevent silent overwrite.
- Make publish, decision, invitation, and external-delivery operations idempotent with an `Idempotency-Key`.
- Return `403` for authorization failure, `404` when a resource must not be disclosed, `409` for stale/conflicting transitions, and `422` for valid JSON that violates a business rule.
- Generate approval review tokens with high entropy, expiration, revocation, per-use audit records, and no ability to browse unrelated resources.

---

## 10. Critical workflows

### A. Establish the baseline scope

1. Agency creates client and project.
2. Agency creates a draft scope version manually or from reviewed AI extraction.
3. Requirements receive stable IDs, descriptions, acceptance criteria, exclusions, assumptions, and references.
4. An authorized agency member publishes the baseline.
5. ScopeLock freezes that version, records an audit event, and optionally invites client viewers.

### B. Handle a change request

1. Client or agency submits a request with description and attachments.
2. Team triages it: clarification, in-scope, potentially out-of-scope, or duplicate/related.
3. Deterministic matching and optional AI analysis link likely affected requirements and explain the evidence.
4. Team proposes impact: effort, price, date/milestone, risks, exclusions, and implementation notes.
5. Team sends an immutable review package to named client approvers.
6. Client approves, rejects, or requests changes; ScopeLock records the decision.
7. If approved, an authorized team member creates/publishes the linked scope amendment. The request may then be marked ready for execution/implemented.

### C. Preserve delivery evidence

1. Team attaches a demo URL, test result, file, release note, or client acceptance note to a requirement.
2. A verifier marks evidence as reviewed/accepted where needed.
3. The project has a defensible requirement-to-delivery trail without turning into a task tracker.

---

## 11. Groq AI design

**Provider/model:** Groq API using `openai/gpt-oss-120b`, called only from the Express API.

**[Updated]** Shipped as a provider abstraction: `AiProvider` interface (`apps/api/src/modules/ai/providers.ts`) with a Groq adapter (primary) and an OpenAI adapter (`gpt-4o-mini` failover), deterministic fallbacks when no key is set, `AI_ENABLED` global kill-switch plus org/project opt-outs, and an extended AI usage log (`AIAnalysis` + usage counters). Prompt-injection fixtures guard the transcript/thread import seam. Decision-memory search and price suggestions are Phase 5 (#20–#21, pending).

### AI capabilities, in delivery order

| Feature | Input | Output | Human control |
| --- | --- | --- |
| Requirement extraction | Proposal text/document excerpt | Editable requirements, acceptance criteria, assumptions, exclusions | Reviewer selects and edits before draft creation |
| Scope Drift Detector | New request + accessible approved requirements | Likely affected IDs, similarity/risk, explanation, missing context | Team classifies and decides; deterministic links shown |
| Clarification generator | Ambiguous request | Suggested concise questions | User reviews before sending |
| Change proposal drafting | Approved impact inputs | Client-facing draft summary | Authorized team member edits/sends |
| Decision Memory summary | Authorized project history | Relevant prior decisions and citations | User opens original records; no independent conclusions |
| Agreement comparison | Two scope versions | Plain-language semantic summary | Deterministic structural diff remains canonical |

### Implementation pattern

```text
apps/api/src/modules/ai/
├── ai.routes.ts
├── ai.service.ts
├── groq.client.ts
├── ai.schemas.ts               # Zod response schemas
├── prompts/
│   ├── extract-requirements.ts
│   ├── analyze-scope-drift.ts
│   ├── generate-clarifications.ts
│   └── draft-change-proposal.ts
└── ai.service.test.ts
```

### AI safety and quality controls

- Run policy/access checks before assembling any prompt; retrieve only the authorized project records necessary for the task.
- Minimize PII and attachment content sent to the provider. Prefer selected excerpts and requirement IDs over entire document archives.
- Require structured JSON outputs, validate them with Zod, and reject malformed/unrecognized IDs.
- Store prompt template version, model, source record IDs, timing, outcome, and user review disposition—not secrets or unnecessarily retained raw sensitive content.
- Set request timeouts, retry only safe transient failures, respect rate limits, and expose a non-AI manual workflow when unavailable.
- Treat model output as suggestions. It cannot change price, publish scope, issue an approval, or claim a contractual conclusion.
- Test prompts against realistic ambiguous/injection-like content and ensure quoted project text is treated as data, not instructions.

---

## 12. Epics, stories, and acceptance criteria

Priorities: **P0** = must ship for MVP; **P1** = first expansion; **P2** = later/validated demand.

### Epic 0 — Foundation, developer experience, and design system (P0)

**Goal:** Establish a dependable, consistent codebase before domain complexity grows.

| Story | Acceptance criteria |
| --- | --- |
| As a developer, I can run web/API/database services locally using documented steps. | A new contributor can start the project from README; `.env.example` is complete; no real secret is required in Git. |
| As a developer, I receive fast feedback on unsafe or broken changes. | Typecheck, lint, unit tests, API tests, and build run in CI; a failing step prevents merge/deploy. |
| As a user, I see a consistent, accessible interface. | Shared tokens/components use Tailwind/shadcn; keyboard navigation and focus states work; forms expose labels/errors. |
| As an operator, I can diagnose a request failure. | API emits structured logs with correlation IDs; production errors have safe user messages and reportable diagnostics. |

### Epic 1 — Identity, organization, and access (P0)

**Goal:** Securely separate organizations and give each person only the access they need.

| Story | Acceptance criteria |
| --- | --- |
| As an agency owner, I can create my organization and invite teammates. | Invite is email-addressed, expiring, revocable, single-use; acceptance creates the intended membership and audit event. |
| As an owner/admin, I can assign roles and remove access. | Server-side role changes take effect immediately; removed users lose project access; all changes are audited. |
| As a client user, I can access only projects my organization shared with me. | Cross-tenant/project ID probing yields no data; client UI exposes no other agency records. |
| As a user, I can use a secure session. | Protected endpoints reject invalid/expired sessions; logout/session invalidation works; session secrets are not exposed to browser code. |

### Epic 2 — Clients and projects (P0)

**Goal:** Give agencies an organized place to create the scope boundary for each engagement.

| Story | Acceptance criteria |
| --- | --- |
| As an agency member, I can create and edit a client record. | Name, contacts, and optional company details validate; records belong to exactly one organization. |
| As an agency member, I can create a project for a client. | Project has name, currency, dates/budget where applicable, status, and assigned members. |
| As a project lead, I can give client contacts a project role. | Only permitted agency roles can invite; assigned client users see the project at their configured permission level. |
| As a user, I can see my accessible projects and their pending work. | Dashboard list is authorization-filtered and shows status/pending-decision counts without leaking data. |

### Epic 3 — Scope Ledger and agreement versions (P0)

**Goal:** Turn an agreement into a durable, structured baseline.

| Story | Acceptance criteria |
| --- | --- |
| As a project lead, I can draft requirements with acceptance criteria and exclusions. | Requirement forms validate required fields; drafts autosave or explicitly save; items may be reordered and categorized. |
| As a project lead, I can publish an approved scope baseline. | Publish validates a non-empty complete draft, assigns a sequence/version, makes its contents immutable, and creates an audit event. |
| As a viewer, I can inspect any historical version. | A historical version renders its exact requirements/metadata even after newer amendments exist. |
| As a project lead, I can compare two versions. | Diff clearly labels additions, removals, and modifications at requirement-field level; it can be linked from activity. |
| As a team member, I can declare assumptions and exclusions. | They are versioned alongside requirements and visible in change analysis/review packages. |

### Epic 4 — Change request capture and assessment (P0)

**Goal:** Convert ad hoc requests into clear, reviewable work proposals.

| Story | Acceptance criteria |
| --- | --- |
| As a client or agency user, I can submit a change request. | Submission captures summary, description, source, attachments, submitter, and time; request begins in an auditable status. |
| As a project lead, I can triage and classify the request. | Lead can mark in-scope, potential change, duplicate, or needs clarification with a rationale; state changes are audited. |
| As an estimator, I can link affected requirements and capture impact. | Links identify the target version/requirement; impact includes effort, price, currency, timeline/milestone effect, risks, and notes. |
| As a project lead, I can request clarification. | Questions are visible to the intended recipient; answers are timestamped and preserved in the request history. |
| As a project lead, I cannot send an incomplete proposal. | Sending is blocked until required impact/approver/package fields are valid. |

### Epic 5 — Client decisions and approval workflow (P0)

**Goal:** Capture an explicit decision on exactly what the client reviewed.

| Story | Acceptance criteria |
| --- | --- |
| As a project lead, I can send a change proposal to named approvers. | Review package includes request, impacted requirements, impact summary, attachments, and expiry; server records a content checksum. |
| As a client approver, I can approve, reject, or request changes. | Decision requires authenticated/secure token access and an explicit confirmation; comment is available/required per decision policy; actor/time/IP metadata are audit-recorded. |
| As a client, I can see outstanding decisions in one inbox. | Only assigned packages appear; each shows decision status, expiry, and the exact version currently under review. |
| As a project lead, I see when an approval is invalidated. | Material package edits invalidate pending approvals and require a newly sent package; old decisions remain visible as historical. |
| As a project lead, I can convert an approved change into scope. | Conversion creates a new draft/amendment from the approved package; final publish is explicit and auditable. |

### Epic 6 — Audit trail, decision memory, and exports (P0 / P1)

**Goal:** Make the project history trustworthy and usable in conversations, reporting, or disputes.

| Story | Priority | Acceptance criteria |
| --- | --- | --- |
| As a user, I can view chronological project activity. | P0 | Activity shows actor, action, target, time, and safe summary; filters are authorized and paginated. |
| As a lead, I can record a decision note with rationale. | P0 | Note links to project/resource, has author/time, is editable only under documented policy, and edits are audited. |
| As a lead, I can export a change summary. | P1 | Export contains scope references, impact, decisions, timestamps, and excludes records the requester cannot access. |
| As a viewer, I can navigate from a decision to evidence. | P1 | Decision, change, scope version, and attachment links resolve only if user has permission. |

### Epic 7 — AI-assisted scope intelligence (P1, staged behind P0 workflow)

**Goal:** Reduce manual reading and drafting while retaining human control.

| Story | Acceptance criteria |
| --- | --- |
| As a lead, I can extract editable requirements from a proposal. | AI output is structured/validated, references input source, is clearly labeled draft, and requires review before scope creation. |
| As a lead, I receive scope-drift suggestions for a new request. | UI shows likely requirement IDs, confidence/risk, explanation, and source excerpts; lead can accept/dismiss each link. |
| As a user, I can generate clarification questions. | Questions are not sent automatically; user can edit/select them before sharing. |
| As a lead, I can draft a client-facing proposal. | Draft uses approved input fields, is editable, and never sends/publishes automatically. |
| As an admin, I can understand AI usage. | Project/organization usage log shows action, model, time, status, cost/usage approximation if available, and no secret content. |

### Epic 8 — Files and delivery evidence (P1)

**Goal:** Safely connect documents and proof of delivery to the scope record.

| Story | Acceptance criteria |
| --- | --- |
| As an authorized user, I can upload an attachment. | API authorizes before issuing a short-lived upload URL; server records metadata/checksum; type/size allowlists are enforced. |
| As an authorized user, I can download a private file. | Download URL is short-lived and scoped; unauthorized requests cannot obtain it. |
| As a team member, I can attach evidence to a requirement. | Evidence supports URL/file/note types, status, author/time, and optional verification; the requirement history displays it. |
| As an operator, I can protect storage from abuse. | Uploads have quotas, virus/malware scanning strategy before broad access, lifecycle/retention policy, and no public bucket listing. |

### Epic 9 — Notifications and realtime updates (P1)

**Goal:** Ensure decisions do not sit unseen, without making realtime a correctness dependency.

| Story | Acceptance criteria |
| --- | --- |
| As a client, I am notified when a proposal needs my decision. | Email/in-app notification is queued through an outbox after transaction success; delivery status and retry behavior are recorded. |
| As a lead, I receive reminders before an approval expires. | Reminder schedule is configurable; duplicate reminders are suppressed and auditable. |
| As an active collaborator, I see relevant changes promptly. | If Ably is enabled, API authorizes a project channel token; events trigger query refresh and never contain more data than the viewer can access. |
| As a user, the product still works during realtime outages. | REST refresh/polling remains correct; database state is unaffected by dropped/reordered events. |

### Epic 10 — Scope health, bundles, and dependencies (P1)

**Goal:** Give leads a small set of proactive signals rather than another busy dashboard.

| Story | Acceptance criteria |
| --- | --- |
| As a lead, I can see scope health at a glance. | Health explains its inputs: aging requests, pending/expired approvals, unlinked requests, and unapproved implementation; it is not a black-box score alone. **[Shipped + extended:** sixth `unlinked-work` signal fed by merged GitHub work; merged-without-approval changes join unapproved implementation.**]** |
| As a lead, I can bundle related changes. | Bundle preserves each original request, produces a combined impact/review package, and prevents double counting. |
| As a lead, I can define approval dependencies. | A blocked request cannot be sent/marked approved until its prerequisite satisfies the configured condition; override requires authorized rationale. **[Shipped #15** alongside escalation: configurable schedule, dedupe, second-approver/agency-lead escalation.**]** |
| As a lead, I can find related historical decisions. | Search filters by project/authorized records and links to original context. |

### Epic 11 — Integrations and commercial maturity (P2)

**Goal:** Connect ScopeLock to surrounding workflows only after the core loop has repeat usage.

| Story | Acceptance criteria |
| --- | --- |
| As a team, I can link an approved change to an external work item. | Integration is opt-in, stores minimal external identifiers, handles revoked credentials, and never changes scope state from an external event without policy. **[Shipped #17:** GitHub connections + signed receiver, ref parsing, auto-linking, health feed; Linear/Jira behind the same `ExternalProvider` interface later.**]** |
| As an owner, I can manage plan limits/usage. | Usage is transparent, limits fail gracefully, and billing logic is isolated from scope/approval records. |
| As an agency, I can apply branding to client review pages. | Branding is organization-scoped, accessible, and cannot weaken authorization or provenance. |

---

## 13. MVP scope and development sequence

### P0 release checklist

- Identity, organization membership, project access, clients, and projects.
- Scope Ledger: draft requirements, publish baseline, historical versions, structural diff.
- Change request capture, triage, impact assessment, requirement links.
- Secure named-client approval flow and client decision inbox.
- Audit activity and decision notes.
- Transactional notifications for invitations and approvals.
- Tests, basic observability, backups/migration process, and security controls.

### Deliberately defer from MVP

- R2 uploads except perhaps a limited proposal attachment flow.
- Ably realtime; use TanStack Query invalidation/refetch initially.
- AI extraction/drift analysis until the manual workflow is stable, then release as an opt-in beta.
- Bundles, dependencies, delivery evidence, external integrations, branded portals, billing.

### Suggested eight-week build order

| Week | Outcome |
| --- | --- |
| 1 | Monorepo, CI, Prisma/Neon connection, auth/session foundation, UI shell |
| 2 | Organizations, invitations, role/policy middleware, clients, projects |
| 3 | Scope drafts, requirements, baseline publishing, immutable versions |
| 4 | Version diff, audit events, project activity, usable project workspace |
| 5 | Change capture, triage, affected-requirement links, impact estimation |
| 6 | Review packages, client decision flow, approval invalidation, notifications |
| 7 | E2E hardening, security review, accessibility, pilot export/reporting needs |
| 8 | Pilot onboarding, feedback instrumentation, bug fixes; begin AI beta only if P0 loop is reliable |

### Success signals for a pilot

- A pilot agency publishes at least one baseline scope in its own project.
- At least one real change request completes the submit → assess → decision loop.
- Teams can find the controlling scope version and decision without asking a teammate.
- Clients understand a proposal and complete a decision without live hand-holding.
- No cross-tenant access, lost audit events, or ambiguous approval records are found in testing/pilot review.

---

## 14. Testing strategy

| Layer | Tools / focus | Examples |
| --- | --- | --- |
| Unit | Vitest; domain services and pure rules | version immutability, status transitions, price math, approval invalidation, authorization policy |
| API integration | Supertest + isolated test database | tenant scoping, malformed payloads, atomic publish/decision transactions, presigned URL authorization |
| Contract | shared Zod schemas / generated client use | API request/response compatibility and error envelope consistency |
| End-to-end | Playwright | agency creates baseline; client submits/approves change; permissions; expired/invalidation flow |
| Security regression | automated negative tests | IDOR attempts, role downgrade, token reuse/expiry, secrets absent from browser bundle |
| AI evaluation | curated fixtures and human review | structured output schema, correct source attribution, low-confidence handling, prompt injection resistance |
| Accessibility | automated scan plus keyboard/manual checks | dialog focus, form error announcements, contrast, approval flow on mobile |

**[Updated]** Shipped gates (all green per feature): `prisma:validate`, `build`, `typecheck`, `lint` (zero warnings), `test` (domain 18 files/110 tests + API 30 files/189 tests), `test:contracts`, `e2e` (25 Playwright tests incl. axe-core serious/critical checks per flow), `npm audit`, migration drift checks (`migrate diff --exit-code`, empty), `npm run audit:verify` (hash-chain recomputation), `node scripts/check-i18n.mjs` (CI missing-key check), `npm run openapi -- --check` (spec freshness), `npm run screenshots` (portfolio-seeded captures embedded in README). Live-Postgres store smoke runs against scratch databases; seed:portfolio is resumable and demoable.

Required high-risk E2E scenarios:

1. A client cannot open another organization’s project by changing an ID.
2. A published scope cannot be modified in place.
3. A material proposal edit invalidates the earlier pending approval.
4. Only an authorized approver can decide, and the final decision ties to the reviewed package checksum.
5. A database failure during publish/decision leaves no partial state or missing audit record.
6. AI output with invented requirement IDs cannot be accepted as a valid link.

---

## 15. Security, privacy, and reliability

### Security baseline

- HTTPS in production; secure, `HttpOnly`, `SameSite` session cookies where cookie sessions are used.
- Strong password/OAuth provider configuration, MFA for owners/admins when supported, and rate limits for authentication and approval endpoints.
- Zod validation at the trust boundary; parameterized Prisma queries; avoid raw SQL unless reviewed.
- Explicit tenant/project policy checks for every record read or mutation.
- CSRF protection where cookie-based cross-site requests are possible; safe CORS allowlist.
- Content-security policy and output encoding; never render user HTML unsanitized.
- Short-lived signed upload/download URLs; private R2 bucket; file type/size validation and malware scanning strategy.
- Rate-limit public/tokenized review endpoints and log suspicious retries without recording sensitive tokens.
- Dependency updates, automated vulnerability scanning, backups, migration rehearsal, and tested restore procedure.

**[Updated]** Shipped controls: MFA (TOTP + recovery codes) with enforced policy; review-link step-up via email OTP (hashed, expiring, attempt-limited) + typed-name confirmation (identity check, never claimed as e-signature); per-project SHA-256 audit hash chain with row-locked head and genesis marker for pre-existing rows; outgoing-webhook HMAC-SHA256 signatures with timestamp headers and SSRF screening (https-only in prod, private/link-local/loopback blocked post-DNS); API keys shown once, hashed, scoped, rotatable, per-key rate-limited; webhook/connection secrets sealed AES-256-GCM under `AUTH_SECRET`; GitHub receiver signature + delivery-id replay protection; per-group rate limits (default/auth/token/ai/apikey); `SECURITY.md` ships in Phase 6 with the maintainer contact.

### Privacy and AI

- Document which data is sent to Groq and why; make AI features opt-in at organization/project level where practical.
- Use only the minimum authorized text needed for the selected action.
- Do not train product behavior on customer data unless the customer has explicitly agreed and the provider terms support it.
- Support data export/deletion requests according to the target market’s legal requirements; seek legal advice before making compliance claims.
- Do not present ScopeLock records as legally binding contracts or legal advice without jurisdiction-specific review.

### Reliability choices

- Database transactions for workflow transitions; optimistic concurrency for draft edits.
- Outbox + idempotent workers for email/realtime side effects.
- Retries with backoff for safe external calls; never duplicate decisions/notifications after a retry.
- Health checks, error monitoring, and dashboards for failed jobs, approval delivery, AI errors, and latency.

---

## 16. Product UX guidelines

- Lead each screen with the decision it supports, not a dense data table.
- Always show the governing scope version near a change request.
- Make “in scope” versus “new/change” a considered classification with a rationale, not a legal declaration.
- Use plain language on client screens: request, impact, options, decision, and what happens next.
- Show before/after values and explain why an approval was invalidated.
- Keep a visible project activity trail; let users open the primary record from every event.
- Design client approvals for mobile first: a focused review package, accessible attachments, unambiguous decision buttons, and explicit confirmation.

---

## 17. Metrics and feedback loop

Track product events with minimal personal data:

| Metric | What it reveals |
| --- | --- |
| Baseline scope published per active project | Whether teams reach the core setup moment |
| Change request completion rate | Whether requests become structured decisions |
| Median time: submitted → decision | Customer responsiveness and workflow friction |
| Percentage of changes linked to baseline requirements | Quality of scope traceability |
| Approval invalidation rate | Package editing/confusion or normal negotiation behavior |
| Decision without clarification | How understandable proposals are |
| AI suggestion review/accept/dismiss rate | AI usefulness, not just API usage |
| Weekly active projects with a scope action | Retained workflow value |

Run customer interviews around real completed/blocked changes. Ask what they used before ScopeLock, what evidence was missing, and whether the saved time, reduced tension, or recovered revenue justifies payment.

**[Updated]** Shipped: `GET /projects/:id/metrics` serves baselines-published, completion rate, median submit→decision hours, linked-to-baseline rate, invalidation rate, approved-without-clarification rate, and AI suggestion accept/review counts; `GET /projects/:id/health` serves the six explainable signals plus a 0–5 score. Both render on the Health page with per-item detail.

---

## 18. Key risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Product becomes a generic PM tool | Protect the scope/change/approval boundary; integrate rather than replicate task management |
| Approval records are ambiguous | Bind decisions to immutable package snapshots and explicit identities/times |
| Multi-tenant data leak | Enforce server policies and scoped queries; test IDOR cases continuously |
| AI makes confident but wrong claims | Cite source requirements, require review, label uncertainty, and preserve manual workflow |
| External provider/free-tier limits disrupt pilots | Feature flags, quotas, queues, provider abstraction, and non-AI/non-realtime fallbacks |
| Customers expect legal enforceability | Use careful product copy; obtain legal counsel before legal/e-signature claims |
| Too many features delay validation | Ship P0 workflow to 3–5 design partners before P1/P2 investment |

---

## 19. Definition of done for the MVP

The MVP is ready for design partners when it can reliably demonstrate this complete loop:

1. An agency creates a project and grants a client contact access.
2. The agency publishes a structured baseline scope with requirements and exclusions.
3. A client or agency user submits a change request.
4. The agency links it to the baseline, records impact, and sends a review package.
5. The client makes an explicit decision in a secure, understandable interface.
6. ScopeLock preserves the request, package, decision, audit trail, and resulting amendment without exposing cross-tenant data.
7. Core unit, API, and browser tests cover the critical authorization and state-transition paths.

Only then add AI assistance, R2 uploads, Ably updates, bundles, dependencies, and integrations in response to real pilot needs.

**[Updated]** The MVP loop is demonstrated end-to-end by `pilot-loop.spec.ts` plus 24 further Playwright specs, the portfolio seed (16 projects), and embedded screenshots. AI assistance (provider abstraction + failover), bundles, dependencies, and integrations (#16–#17 shipped, #18 in progress, see §21) are past MVP; R2/Ably remain optional drivers with local fallbacks.

---

## 20. Immediate next actions

1. Interview 5–10 target freelancers/agencies using a recent real scope dispute as the walkthrough.
2. Write a clickable low-fidelity flow for baseline scope → change → approval before implementation.
3. Scaffold the monorepo, environment validation, authentication, Prisma schema, and CI.
4. Build the P0 vertical slice for one project end-to-end before broadening the data model.
5. Invite 3–5 design partners, observe their first live change request, and prioritize only friction demonstrated in those sessions.

---

## 21. Expansion implementation log (Phases 0–6)

One `feat/<slug>` branch per feature, small conventional commits, Definition-of-Done gates per feature (contracts + domain tests, migration + 3 store backends, authz/IDOR/contract tests, axe-clean UI + Playwright, audit/outbox, `seed:portfolio`, docs, green gates). Full per-feature audit: `docs/EXPANSION_AUDIT.md`.

### Phase 0 — Hygiene and adoption (Done)

| Work | Branch | Notes |
| --- | --- | --- |
| Production `start`, Dockerfiles, compose (api/web/postgres/healthchecks), “self-host in 5 minutes” README | `feat/prod-deploy` | CI smoke job; no local Docker host, images verified review+CI only |
| CHANGELOG, CONTRIBUTING, issue/PR templates | `feat/community-docs` | `SECURITY.md` deferred to Phase 6 (contact now confirmed) |
| `npm run screenshots` portfolio captures in `docs/screenshots`, README tour | `feat/screenshots` | Regen from seed; embedded in README |
| i18n infrastructure (moved forward from #24) | `feat/i18n-infra` | `messages.en.json` + `useLocale()` + CI missing-key check |

### Phase 1 — Money and contract value (Done)

| # | Feature | Branch | Notes |
| --- | --- | --- | --- |
| 1 | Contract value ledger | `feat/contract-ledger` | Derived baseline + deltas; pending exposure; absorbed work; integer minor units; Contract tab + org rollup; reconciliation test |
| 2 | Rate cards + estimate templates | `feat/rate-cards` | Org rates, contingency/tax, computed-but-overridable pricing with reasons; explicit per-project currency, no silent conversion |
| 3 | Change allowance pool | `feat/allowance-pool` | Client-granted pool as the recorded decision; draw-downs notify with objection window; off by default |
| 4 | Invoice-ready export | `feat/invoice-export` | CSV + JSON approved-change line items per project/period |

### Phase 2 — Intake (Done)

| # | Feature | Branch | Notes |
| --- | --- | --- | --- |
| — | AI provider seam (moved forward from #19) | `feat/ai-provider-seam` | `AiProvider` + Groq/OpenAI failover, deterministic fallbacks, usage log |
| 5 | Public intake form | `feat/intake-form` | Revocable token link + embeddable page; rate-limit, honeypot, size caps; `SUBMITTED` + `INTAKE_FORM` + unverified flag |
| 6 | Pre-submission scope check | `feat/scope-check` | Deterministic lexical match first, optional AI refinement; advisory, “submit anyway”; suggestion-vs-classification metrics |
| 7 | Inbound email | `feat/inbound-email` | Provider-agnostic signed webhook + replay protection, unguessable aliases, strip/loop-guard, upload+malware pipeline, local simulator |
| 8 | Transcript/thread import | `feat/transcript-import` | AI draft changes with excerpts; human accept/edit; prompt-injection fixtures |

### Phase 3 — Stronger decisions (Done)

| # | Feature | Branch | Notes |
| --- | --- | --- | --- |
| 9 | Approval policies | `feat/approval-policies` | ANY/ALL/SEQUENTIAL + amount thresholds in `domain`; checksum still binds every decision |
| 10 | Proposal options + PARKED | `feat/proposal-options` | 2–4 priced options, pick-one-or-reject; parked view + revival |
| 11 | Step-up verification | `feat/step-up-verification` | Email OTP (hashed/expiring/attempt-limited) + typed-name record; identity check, not e-signature |
| 12 | Change Order PDF + certificate | `feat/change-order-pdf` | Deterministic pdf-lib PDF + QR to public `/verify/:approvalId` checksum recomputation |
| 13 | Tamper-evident audit | `feat/audit-hash-chain` | Per-project SHA-256 chain, row-locked head, genesis marker, verify endpoint + CLI + concurrency test |
| 14 | Delivery acceptance | `feat/delivery-acceptance` | Review-link acceptance; deemed-after-N-days as `actor=policy`, never a client decision |
| 15 | Escalation + dependencies | `feat/approval-escalation` | Exactly-once escalation (nudge or agency lead); DEPENDS_ON prerequisites re-verified at decision time |

### Phase 4 — Integrations (#16–#17 Done, #18 in progress)

| # | Feature | Branch | Status | Notes |
| --- | --- | --- | --- | --- |
| 16 | Outgoing webhooks + API keys + OpenAPI | `feat/webhooks-api-keys` | Done | HMAC-SHA256 + timestamp headers, outbox backoff, delivery log + replay, SSRF guard; `sk_` keys scoped/rotatable/rate-limited; generated + served spec (`npm run openapi -- --check`) |
| 17 | GitHub linking | `feat/github-linking` | Done | Opt-in connections, signed receiver, `CHG/REQ-###` parsing (titles/bodies/branches/commits), idempotent auto-linking, unlinked-work health signal; Linear/Jira behind `ExternalProvider` later; external events never change scope state |
| 18 | Notification channels | `feat/notification-channels` | Done | Slack (org webhook) for approvers/leads; SMS/WhatsApp provider interface + log driver; per-user prefs (email/SMS/WhatsApp + E.164 phone); all through outbox. Shipped: domain/contracts, migration 0019, stores, drivers, routes, worker fan-out, UI, specs, seed, docs, gates |

### Phase 5 — Intelligence (done)

| # | Feature | Status | Notes |
| --- | --- | --- | --- |
| 19 | AI provider abstraction | Done (`feat/decision-search`) | AiProvider + Groq primary / OpenAI failover + deterministic fallbacks + extended usage log; failover integration tests closed out the remaining scope |
| 20 | Decision memory search | Done (`feat/decision-search`) | Lexical ranking everywhere; pgvector semantic only when Postgres + `OPENAI_API_KEY` configured, else silent lexical fallback; access filtered before ranking; verbatim excerpts + links, no generated conclusions; dashboard panel, OpenAPI path, worker embedding sweep, migration 0020 |
| 21 | Price suggestions + actuals | Done (`feat/price-suggestions`) | Deterministic comparable ranking (same currency, real approved prices, no generated number); actuals on implemented changes + audit; estimate-vs-actual report; change panels + Actuals tab; migration 0021 |

### Phase 6 — Platform (#22 done; #23–#24 pending)

| # | Feature | Status | Notes |
| --- | --- | --- | --- |
| 22 | Scope templates + CSV import | Done (`feat/scope-templates`) | Org library (assumptions/exclusions/items per project type, staff-only) instantiating into a draft in one tx + audit; dependency-free CSV parser, dry-run preview with per-row errors, atomic import via error envelope; settings UI + scope dialogs; `template.*` policy actions + key scopes; migration 0022 |
| 23 | OAuth + passkeys | Done (`feat/oauth-passkeys`) | Google/GitHub code+PKCE via pinned openid-client (arctic deprecated); verified-email match linking, prior-link login, TOTP still enforced; WebAuthn via pinned SimpleWebAuthn with sealed challenges + UV-gated MFA; last-method guards; migration 0023 |
| 24 | i18n | Partial | Infra shipped (catalog, `useLocale()`, CI check); remaining: full string extraction, Bangla (`bn`), per-user language, review-link org/project default |
| — | `SECURITY.md` | Missing | Contact confirmed (`codejborg@junaidul.pro.bd`); to be written with the Phase 6 close-out + final report |

### Standing risks and deferred items

- No local Docker host: images and the compose CI job are review + CI verified only.
- `npm audit --audit-level=high` exits 1 on pre-existing transitive advisories; no new advisories introduced by expansion work.
- Intermittent parallel-load test flakes; affected files pass in isolation and gates re-run to green.
- Neon (remote) migrations trail local: production `migrate deploy` runs after all tasks complete.

---

*ScopeLock should earn trust by making the current agreement and every later decision easy to inspect. AI, files, realtime events, and integrations are valuable accelerators—but the versioned Scope Ledger and explicit approval flow are the product’s foundation.*
