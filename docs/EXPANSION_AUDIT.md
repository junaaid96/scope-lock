# ScopeLock Expansion Audit

Scope: the 23 numbered features plus Phase 0 hygiene from the expansion brief,
measured against the repo as of 2026-10-18 (`main` branch working tree).
Status scale: **Done** (ship-quality, do not rebuild) / **Partial** (finish the
remainder) / **Missing** (build from scratch, reusing cited foundations).

Files read for this audit: `README.md`,
`plan/ScopeLock_Product_and_Technical_Development_Plan.md`, `docs/OPERATIONS.md`,
`docs/flow.md`, `.env.example`, `prisma/schema.prisma`,
`prisma/seed-portfolio.ts` (head), every module under `apps/api/src`
(`app.ts`, `env.ts`, `http/*`, `lib/*`, `modules/*`, `store/*`),
`packages/domain/src/*`, `packages/contracts/src/*`, `apps/web/src` (structure +
spot checks), `apps/api/tests` + `apps/web/e2e` (inventory + targeted greps),
`.github/workflows/ci.yml`, root and workspace `package.json` files.

## Cross-cutting foundations (already Done — reuse, do not rebuild)

- Authz core: `apps/api/src/http/access.ts` (`requireOrgAccess`,
  `requireProjectAccess`, `requireAction`) + `packages/domain/src/policy.ts`
  (`can()`, 40 actions). New permissions extend `Action` with unit tests in
  `packages/domain/tests/policy.test.ts`.
- Store triad behind one interface: `apps/api/src/store/store.ts`, with
  `prisma-store.ts` (interactive transactions, 30s timeout for Neon),
  `file-store.ts`, `memory.ts` (serialized snapshot transactions with
  rollback). Transactions commit publish/decision/send + audit + outbox
  atomically (`modules/scope.ts` publish, `modules/approvals.ts`
  `recordDecision`, `lib/worker.ts` expiry/reminders).
- Outbox: `OutboxEvent` (`EMAIL`/`REALTIME`), idempotent delivery with
  exponential backoff, 8 attempts then `DEAD` (`lib/worker.ts`,
  `lib/email.ts` log driver, `lib/realtime.ts`). Every new channel rides this.
- Review-link pattern: high-entropy tokens (`newToken`), SHA-256 storage,
  expiry, revocation, `token` rate-limit group (60/min/IP), full audit
  (`modules/approvals.ts`, `http/rate-limit.ts`). Reuse for intake links,
  acceptance links, verify pages.
- Immutable review packages bound by `checksumOf` over canonical JSON
  (`packages/domain/src/checksum.ts`); material edits invalidate
  (`modules/changes.ts` `invalidateApprovalsForChange`); decisions re-verify
  the checksum in-transaction.
- Money in integer minor units (`packages/domain/src/money.ts`,
  `combineBundlePrice`); `CurrencySchema`/`MinorUnitsSchema` in
  `packages/contracts/src/common.ts`.
- Deterministic drift detector (`packages/domain/src/drift.ts`, Jaccard +
  title boost, excerpts + matched terms) composed with AI refinement in
  `modules/ai/service.ts` `analyzeScopeDrift`; invented IDs rejected.
- AI guardrails: `AI_ENABLED` > org `aiEnabled` > project `settings.aiEnabled`,
  plan quotas (`lib/limits.ts`), Zod-validated JSON, `AIAnalysis` usage log,
  deterministic fallbacks per capability, injection fixtures
  (`apps/api/tests/ai.test.ts`).
- Upload + malware pipeline: presigned intents, allowlists, quotas, SHA-256,
  EICAR + magic-byte heuristics, optional external scanner, quarantine
  (`modules/files.ts`, `lib/scan.ts`).
- Lifecycle invariants enforced: published versions immutable
  (`modules/scope.ts` `assertDraft`), RULE4 amendment gate (publish requires
  linked APPROVED change), approval only via recorded decision by eligible
  approver (`recordDecision` + `approval.decide` policy).

## Phase 0 — Hygiene and adoption

| Item | Status | Evidence / remainder |
| --- | --- | --- |
| Real production `start` scripts | **Partial** | `apps/api/package.json` already has `"start": "node dist/index.js"` (real). Root `package.json` has no `start`; web is a static Vite build (`preview` only). Remainder: root-level `start` orchestration + docs. |
| Dockerfile(s) + docker-compose (api, web, postgres, healthchecks) | **Missing** | No `Dockerfile*` or `compose` files anywhere. `/healthz` + `/readyz` probes exist (`app.ts`) and are compose-ready. |
| Replace README `dev:api`-in-production example with "self-host in 5 minutes" | **Missing** | `README.md` "Production-like run" section still shows `NODE_ENV=production npm run dev:api`. |
| SECURITY.md (contact address to be supplied) | **Missing** | No file. README "Report issues" tells security reporters to email maintainers but names no address. **Blocked on user-supplied contact.** |
| CHANGELOG.md | **Missing** | No file. |
| CONTRIBUTING.md split out of README | **Missing** | Contributing content lives inline in `README.md` ("Open source & contributing"); nothing extracted. |
| Issue/PR templates | **Missing** | `.github/` contains only `workflows/ci.yml`. |
| `npm run screenshots` (Playwright → `docs/screenshots`, embedded in README) | **Missing** | No script, no `docs/screenshots/`. Portfolio seed + one-click demo logins exist (`prisma/seed-portfolio.ts`, `pages/Login.tsx`) to drive it. |

## Phase 1 — Money and contract value

| # | Feature | Status | Evidence / remainder |
| --- | --- | --- | --- |
| 1 | Contract value ledger | **Missing** | Foundations exist: `Project.budgetMinor`, `ChangeImpact.priceMinor`, money module, bundle totals. No derived ledger (baseline + approved deltas), no pending exposure / absorbed work, no rollups, no Contract tab, no reconciliation test. |
| 2 | Rate cards + estimate templates | **Missing** | No rate-card/template models, routes, or UI. `effortDays` + `priceMinor` are free-form today (`contracts/scope-changes.ts` `UpsertImpactSchema`). |
| 3 | Change allowance pool | **Missing** | Only "allowance" in repo is the AI quota message (`lib/limits.ts`). No pool model, draw-down, objection window, or client visibility. |
| 4 | Invoice-ready export (CSV + JSON line items per project/period) | **Partial** | Single-change JSON export exists: `GET /projects/:id/export/change/:changeId` (`modules/activity.ts`). Remainder: project/period line-item query, CSV format, JSON envelope for the batch form. |

## Phase 2 — Intake

| # | Feature | Status | Evidence / remainder |
| --- | --- | --- | --- |
| 5 | Public intake form (token link + embed) | **Missing** | No public intake endpoint. `CreateChangeSchema.source` allows only `CLIENT`/`AGENCY` (`contracts/scope-changes.ts`); no `INTAKE_FORM`, no unverified-submitter flag. Review-link token machinery is the reusable pattern. |
| 6 | Pre-submission scope check (in intake + in-app) | **Partial** | In-app deterministic + AI-refined check exists (`POST /change-requests/:id/ai/scope-analysis`, `detectDrift` returns IDs + excerpts). Remainder: surface in intake form, "submit anyway" advisory UX, suggestion-vs-final-classification metric logging (only generic AI accept-rate exists in `GET /projects/:id/metrics`). |
| 7 | Inbound email | **Missing** | Outbound-only email (`lib/email.ts` Resend/log drivers). No webhook, alias addresses, reply stripping, loop detection, or simulator. |
| 8 | Transcript/email-thread import → draft change requests | **Partial** | `EXTRACT` imports pasted text into draft *requirements* (`ai/service.ts` `extractRequirements`); injection fixtures exist (`tests/ai.test.ts`). Remainder: propose one draft *change request* per implicit ask with source excerpts, accept/edit flow, injection fixtures extended to the new prompt. |

## Phase 3 — Stronger decisions

| # | Feature | Status | Evidence / remainder |
| --- | --- | --- | --- |
| 9 | Approval policies (ANY/ALL/SEQUENTIAL + amount thresholds) | **Missing** | First decision wins today: `recordDecision` flips `SENT → DECIDED` and rejects later decisions (`modules/approvals.ts`). No policy model, aggregation logic, or thresholds. |
| 10 | Proposal options + PARKED status | **Missing** | No options on `ReviewPackageSnapshot`, no `PARKED` in `ChangeStatuses` (`domain/enums.ts`), no parked view/revival. |
| 11 | Step-up verification (email OTP) + typed-name confirmation | **Missing** | Review decision requires only a checkbox confirm (`pages/Review.tsx`, `DecideApprovalSchema.confirm`). TOTP MFA exists for *sessions* (`lib/mfa.ts`, sealed secrets + recovery codes) — reusable patterns, different feature. Note: Review UI copy says "the first decision is binding" — keep the no-e-signature rule in mind when wording this feature. |
| 12 | Change Order PDF + decision certificate + public verify | **Missing** | No PDF generation, no QR, no public verify endpoint. Checksum + immutable package + `change.exported` payload are the inputs. |
| 13 | Tamper-evident audit hash chain | **Missing** | Audit is append-only with no hashes (`store/types.ts` `AuditEvent`, `lib/audit.ts`). No `prevHash`, no chain-head locking, no verify endpoint/CLI, no genesis migration, no concurrency test. |
| 14 | Delivery acceptance via review links + deemed acceptance | **Partial** | Evidence attach/verify exists agency-side (`evidence.attach`/`evidence.verify`, `modules/requirements.ts`, verifier + `verifiedAt`). Remainder: client-facing acceptance over the review-link mechanism, N-day deemed acceptance with reminders recorded as `actor=policy`, never a client decision. |
| 15 | Reminders + escalation + approval dependencies | **Partial** | **Done, skip:** configurable reminder schedule (`ProjectSettingsSchema.reminderHoursBeforeExpiry`, create + update), dedupe (`remindersSent` + per-email idempotency keys), worker delivery in-transaction with audit (`lib/worker.ts`); approval dependencies end-to-end (`DEPENDS_ON` + `PREREQ_APPROVED`/`PREREQ_IMPLEMENTED`, checked at send *and* decision, override rationale, `getDependencyBlockers` in `modules/changes.ts`, covered in `tests/changes-approvals.test.ts`, demoed in `docs/flow.md`). **Remainder (Missing):** escalation to a second approver/agency lead. |

## Phase 4 — Integrations

| # | Feature | Status | Evidence / remainder |
| --- | --- | --- | --- |
| 16 | Outgoing webhooks + API keys + OpenAPI from Zod | **Missing** | Outbox has only `EMAIL`/`REALTIME`; no subscriptions, HMAC, delivery log, replay, SSRF guard, API-key model, or OpenAPI generator. `http/auth.ts` is session-only. |
| 17 | GitHub linking behind provider interface | **Partial** | Manual linking exists: `ExternalLink` (provider/externalId/url minimal), opt-in `Project.externalIntegrationsEnabled`, `external.manage` policy, `modules/external.ts` CRUD + audit; health signals cover unlinked *requirements* and unapproved implementation (`domain/health.ts`). Remainder: provider interface, signature-verified webhook, `CHG-###`/`REQ-###` parsing from PRs/branches/commits, merged-work-without-approved-link signal. External events already cannot change scope state (no inbound path at all). |
| 18 | Slack / WhatsApp / SMS + per-user preferences | **Missing** | Channels are in-app + email + realtime fan-out only (`lib/notify.ts`). No channel preferences on user/project, no provider interface beyond email/realtime drivers. |

## Phase 5 — Intelligence

| # | Feature | Status | Evidence / remainder |
| --- | --- | --- | --- |
| 19 | AI provider abstraction (interface + Groq + fallback adapter) | **Partial** | Single direct client: `groqJson` (`modules/ai/groq.ts`, OpenAI-compatible chat, retry on transient, `GROQ_BASE_URL` override). Deterministic fallbacks per capability and the `AIAnalysis` usage log exist (`modules/ai/service.ts`). Remainder: provider interface, Groq-as-adapter refactor, ≥1 fallback adapter, extended usage log. |
| 20 | Decision memory search (FTS; pgvector when configured) | **Partial** | Project-scoped naive substring search over decision comments/emails (`Store.listDecisionsWithContext`, e.g. `store/memory.ts`) served by `GET /projects/:id/decisions` with links to originals; `MEMORY` AI summary cites `approvalId`s. Remainder: Postgres FTS in all modes, pgvector semantic search when configured + lexical fallback, access-before-ranking beyond project scope, no-generated-conclusions guarantee in results. |
| 21 | Price suggestions from comparables + actuals + estimate-vs-actual | **Missing** | No comparable search, no `actualEffort` field on changes/impacts, no estimate-vs-actual report. `metrics` endpoint is the natural home for the report. |

## Phase 6 — Platform

| # | Feature | Status | Evidence / remainder |
| --- | --- | --- | --- |
| 22 | Scope templates + requirement library + CSV import | **Missing** | Only reuse mechanism is `copyFromVersionId` on draft creation (`modules/scope.ts`). No template/library models, no CSV import or dry-run anywhere in the repo. |
| 23a | Google/GitHub OAuth (code + PKCE, verified-email linking) | **Missing** | Auth is password + session cookie + password reset + invitations (`modules/auth.ts`). `AUTH_CLIENT_ID/SECRET` env vars exist but are unused placeholders. Remainder is the whole feature; TOTP MFA policy enforcement point already exists. |
| 23b | Passkeys (WebAuthn) | **Missing** | No WebAuthn code or dependency. |
| 24 | i18n (extract strings, Bangla, Intl formatting, per-user language, CI check) | **Missing** | No i18n infra: zero `Intl.*` usage in `apps/web/src`; money is hand-formatted (`` `${currency} ${(minor/100).toFixed(2)}` `` in `components/ui.tsx`); all UI strings inline; no language preference on user/org/project. |

## Phase-order feedback (step 3 of the brief)

I agree with the overall order (hygiene → money → intake → decisions →
integrations → intelligence → platform) with two adjustments proposed:

1. **Pull i18n infrastructure (part of 24) forward into Phase 0/1, leave Bangla
   translation strings for Phase 6.** Phases 1–5 add substantial UI (Contract
   tab, intake form, options picker, acceptance pages, verify pages). Extracting
   strings after that work lands means re-touching every screen; establishing
   the message catalog + `Intl` helpers + missing-key CI check early lets each
   phase ship keys from the start at near-zero marginal cost.
2. **Consider pulling the AI provider interface seam (core of 19) ahead of
   Phase 2.** Features 6 and 8 build new AI consumers; coding them against
   `groqJson` directly and then refactoring behind an interface in Phase 5 is
   avoidable rework. The current seam is already narrow (one function), so this
   is a small job — alternatively, accept the rework and keep the order.

No architectural conflicts found in the phase contents: the allowance-pool
modeling (3), PKCE/verified-email OAuth rules (23), and outbox/local-driver
requirements all respect the lifecycle invariants and architecture rules as
specified.

## Tallies

- Done: 0 whole features (2 sub-items Done inside #15: reminders core,
  approval dependencies).
- Partial: 9 features (#4, #6, #8, #14, #15, #17, #19, #20, #23) + Phase 0
  `start` scripts.
- Missing: everything else, including all of Phase 0 docs/Docker/screenshots.
