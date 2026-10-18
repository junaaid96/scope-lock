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
- Community health files: `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`,
  bug/feature issue templates, and a pull-request template.

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
