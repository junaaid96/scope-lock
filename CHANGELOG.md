# Changelog

All notable changes to ScopeLock are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[SemVer](https://semver.org/).

## [Unreleased]

### Added

- Production deployment path: `apps/api/Dockerfile`, `apps/web/Dockerfile`
  (nginx + same-origin `/api/*` proxy), `docker-compose.yml` (api, web,
  postgres with healthchecks), root `npm start`, and a "Self-host in 5
  minutes" README guide with a CI smoke job for the stack.
- Community health files: `CHANGELOG.md`, `CONTRIBUTING.md`, bug/feature
  issue templates, and a pull-request template (`SECURITY.md` follows once
  the maintainer contact address is confirmed).
- `npm run screenshots`: portfolio-seeded Playwright captures in
  `docs/screenshots`, embedded in the README tour.
- i18n infrastructure: English message catalog + `useLocale()` (`t()`,
  Intl money/date/number), with a CI missing-key check. Bangla,
  per-user language, and full string extraction follow in Phase 6.
- Contract value ledger: derived baseline + approved deltas = current value,
  pending exposure, absorbed (no-charge) work, value by scope version, and a
  per-currency org rollup, with a project Contract tab, dashboard strip, and
  a reconciliation test proving the endpoint equals a recomputation.
- Rate cards and estimate templates: org-level role rates, reusable line
  items with contingency and optional tax lines, computed impact pricing
  with frozen snapshots, and overrides with recorded reasons. Cards that
  priced an impact freeze their rates; agency staff only.
- Change allowance pools: pre-agreed hours/amount buffers that approved
  changes draw from. The pool itself is granted by a recorded client
  decision; every draw notifies the client with a configurable objection
  window, objections pause for lead resolution (uphold or release back).
  Project Allowance tab, grant terms on review links, draw-down visibility
  on the change page.
- Invoice-ready export: approved changes decided in a project/period as
  line items in CSV (RFC 4180) or JSON, with per-currency totals, pricing
  mode, override reasons, and allowance draw status. Contract tab card
  with period pickers; every export is audit-logged.
- AI provider seam: `AiProvider` interface with Groq and OpenAI adapters,
  ordered failover (`AI_PROVIDER` primary), and the serving provider
  recorded in the AI usage log. Deterministic fallbacks unchanged.
- Public intake forms: revocable per-project token links with an embeddable
  page, rate limits, honeypot, and size caps. Submissions create SUBMITTED
  `INTAKE_FORM` changes flagged “unverified submitter” and notify the
  project team; staff manage links from the project Intake tab.
- Pre-submission scope check: deterministic lexical matching against the
  governing baseline in the intake form and the in-app new-change dialog,
  with optional AI refinement in-app. Advisory only (“submit anyway”);
  suggestion-vs-final-classification is logged via `scope_check.outcome`.
- Inbound email: unguessable per-project aliases with a provider-agnostic
  signed webhook (HMAC + 5-minute replay window, message-id dedupe).
  Auto-replies/loops dropped, quoted history stripped, attachments scanned
  before linking; survivors land as unverified `INBOUND_EMAIL` changes.
  Dev simulator route + Intake tab UI included.
- Transcript/thread import: AI proposes one draft change per implicit ask
  with exact source excerpts; a human accepts or edits each into a real
  change request. Data-only prompt framing with injection fixtures; new
  `IMPORT` usage-log kind with review dispositions.
- Approval policies: ANY / ALL / SEQUENTIAL multi-approver decision rules
  with per-project amount thresholds (project Policy tab, staff only) and
  an optional per-send override. Votes aggregate in `packages/domain`;
  partial outcomes keep the package open (sequential runs nudge whoever is
  up next), side effects apply exactly once at the terminal outcome, and
  the checksum still binds every vote. Review pages show each approver's
  state and lock the form out of turn.
- Proposal options + PARKED status: 2–4 priced alternatives per change
  (full / reduced / defer), snapshotted into the review package; the
  client approves exactly one (every approver must pick the same one) and
  the pick becomes the change's effective impact for ledger, export, and
  draw-downs. Option edits invalidate live packages; options freeze once
  decided. PARKED shelves pre-decision work with a board column, a
  changes-tab filter, and revival into a new submission.
- Step-up verification on review links: optional email OTP (hashed,
  10-minute expiry, 5-attempt cap, 60s resend cooldown, bound to the exact
  approval + token + approver, delivered through the outbox) plus typed
  full-name confirmation recorded with each decision. Configurable per
  workspace with per-project inherit/on/off pins; explicitly not an
  e-signature.
- Change Order PDF + decision certificate: deterministic server-side PDF
  for decided packages (package checksum, per-decision record, QR/URL to
  the public verify page) plus `/verify/:approvalId`, which recomputes
  the checksum server-side and shows match/mismatch from the package
  contents only.
- Tamper-evident audit: per-project hash chain (prevHash + SHA-256 over
  canonical JSON, per-chain sequence) written in the same transaction as
  each event, with the chain head serialized by row lock on Postgres.
  `GET /projects/:id/audit/verify`, an Activity-tab integrity card, and
  `npm run audit:verify` recompute the chain; pre-chain events verify as
  explicit legacy rows.
- Delivery acceptance: clients accept delivered requirements over review
  links (criteria + evidence snapshotted; verdicts move requirements to
  ACCEPTED, back to IN_PROGRESS, or leave them DELIVERED), with status,
  evidence, and publish edits invalidating pending packages. A
  configurable per-project deemed window (Policy tab) accepts overdue
  packages by policy — actor `policy`, no client decision row — with
  acceptance-aware reminders and an acceptance-record PDF.
- Approval escalation: packages still awaiting a decision past the
  project's delay (Policy tab, off by default) escalate exactly once —
  either the undecided approvers get a second nudge (whoever's turn it
  is, when sequential) or the agency leads are told the package is
  stalled — with an `approval.escalated` audit event and dedupe keys.
- Outgoing webhooks + API keys: org-scoped event subscriptions with
  HMAC-SHA256 signed deliveries (`X-ScopeLock-*` headers) sent through
  the outbox with exponential backoff, a delivery log with manual
  replay, and SSRF screening (https-only in production; private,
  link-local, and loopback targets blocked including after DNS).
  Machine keys are shown once, stored hashed, scoped to policy actions,
  rotatable, last-used tracked, and rate-limited
  (`API_KEY_RATE_LIMIT_PER_MIN`). Org settings UI plus a generated
  OpenAPI spec served at `GET /api/openapi.json`
  (`npm run openapi [-- --check]`).
- GitHub linking: per-project provider connections (opt-in) with webhook
  secrets shown once and a signature-verified receiver
  (`X-Hub-Signature-256`, delivery-id replay protection). `pull_request`
  and `push` events are normalized to minimal observed work — identifiers
  only, never code — with `CHG-###`/`REQ-###` refs parsed from PR titles,
  bodies, branches, and commit messages. Resolved changes auto-link;
  merged work with no approved link feeds the Health page (unapproved
  implementation + a new unlinked-work signal). External events never
  change scope state. Linear/Jira plug in behind the same provider
  interface later.
- Notification channels: approval lifecycle events (requested, decided,
  escalated, expired, reminders, deemed) fan out to Slack (org incoming
  webhook, one deduped post per event), SMS, and WhatsApp (provider
  interface with log drivers locally), all through the outbox with the
  usual backoff. Per-user preferences (email/SMS/WhatsApp toggles +
  E.164 phone) gate personal delivery, including existing emails; the
  Slack URL is SSRF-screened, sealed at rest, and never returned by the
  API. Org settings UI plus spec coverage.
- Decision memory search: lexical ranking over decided approvals today,
  semantic pgvector ranking when Postgres and an embeddings provider
  (`OPENAI_API_KEY`) are configured, with silent lexical fallback — search
  never fails for lack of embeddings. Candidates are filtered by the
  requester's project access before ranking; results carry verbatim
  excerpts and links to the original records, never generated conclusions.
  A dashboard panel, OpenAPI path, and a worker sweep that embeds newly
  decided approvals are included. No new env vars.

## [0.1.0] - 2026-10-16

First open-source release.

### Added

- Scope Ledger: versioned requirements with assumptions/exclusions, immutable
  published baselines, and requirement-level agreement diffs.
- Change requests: submit → triage → estimate → approve → implement loop with
  impact assessment, clarifications, bundles, and approval dependencies.
- Client approvals: login-free review links bound to immutable package
  checksums, in-app decision inbox, reminders, and expiry handling.
- AI assistance (Groq, server-side, opt-out capable): requirement extraction,
  scope-drift analysis, clarification questions, proposal drafts, decision
  memory, and agreement comparison — all advisory with deterministic fallbacks.
- Files and delivery evidence: presigned uploads, malware scanning with
  quarantine, signed downloads, and requirement-level evidence verification.
- Portfolio demo seed: 16-project CodeJBorg workspace with showcase lifecycles
  covering every change state.
- Operations guide, project health signals, product metrics, and full
  typecheck/lint/unit/integration/contract/e2e/a11y CI gates.
