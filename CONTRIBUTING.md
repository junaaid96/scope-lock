# Contributing to ScopeLock

ScopeLock is free and open-source software under the [MIT License](LICENSE).
Thanks for helping make client scope boring and auditable.

## Report issues

Open a GitHub issue with steps to reproduce, expected vs actual behavior, and
the relevant API log line (it carries a `correlationId`). Use the bug-report
template for defects and the feature-request template for proposals.

**Do not file public issues for security vulnerabilities** — see
[SECURITY.md](SECURITY.md) for how to report them privately.

## Contribute code

1. **Fork** the repo and clone your fork, then follow the
   [README setup guide](README.md#setup--run-detailed).
2. **Branch** from `main`: `git checkout -b feat/short-name`
   (or `fix/…`, `docs/…`). Use small conventional commits.
3. **Change** as little as possible to solve the problem. Match surrounding
   conventions: the Express API owns all business logic and authorization,
   React never touches the database or provider credentials, and every
   protected action checks membership server-side (see the README's
   [Architecture rules](README.md#architecture-rules-enforced-in-code)).
4. **Verify** with the same gates CI runs (`.github/workflows/ci.yml`):

   | Gate | Command | Covers |
   | --- | --- | --- |
   | Schema | `npm run prisma:validate` | Prisma schema validity |
   | Build | `npm run build` | packages → API → web compile |
   | Types | `npm run typecheck` | `tsc --noEmit` in every workspace |
   | Lint | `npm run lint` | ESLint, zero warnings |
   | Unit + API | `npm run test` | domain rules + API integration suite |
   | Contracts | `npm run test:contracts` | error envelopes + pagination |
   | Postgres | `TEST_DATABASE_URL=…` smoke + `migrate deploy` | migrations apply cleanly |
   | E2E + a11y | `npm run e2e` | Playwright flows + axe scans (serious/critical) |
   | Deps | `npm audit --omit=dev --audit-level=high` | advisory vulnerability scan |

5. **Test your change**: bug fixes must add a regression test, new API
   behavior needs integration coverage, and user-facing web flows need a
   Playwright spec (see `apps/web/e2e/`). Never weaken an existing test to
   make a change pass.
6. **Document** user-visible behavior in the README where users will look
   for it (setup, tour, env vars, scripts). New environment variables go in
   `.env.example` too. New UI strings go in
   `apps/web/src/lib/i18n/messages.en.json` and render via `useLocale()`'s
   `t()` (money/date/number via its `money`/`date`/`number` helpers);
   `node scripts/check-i18n.mjs` (also a CI step) fails on unknown or
   dynamically constructed keys.
7. **Open a PR** against `main` with a clear description, linked issue, and
   verification evidence (which gates you ran). Keep PRs focused — one
   concern per PR.

New here? Issues labeled `good first issue` are the fastest way in
(suggested starter areas: e2e coverage for the board/timeline edge cases,
accessibility polish, docs).
