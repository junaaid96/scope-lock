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
