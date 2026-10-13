# Pilot flow: baseline → change → approval

Plan §20 item 2 asked for a clickable low-fidelity flow before implementation.
That prototype is superseded: the flow below is implemented, tested end to end
(`apps/web/e2e/pilot-loop.spec.ts`), and runnable locally per
[README.md](../README.md). Use this note as the walkthrough script for design
partners.

## Roles

- **Olivia (agency owner)** — creates the workspace, clients, projects, scope,
  and review packages.
- **Carl (client approver)** — submits requests, answers clarifications, and
  decides from secure review links (no account required for email invitees).

## The loop

1. **Register & workspace** — Olivia registers at `/register`; a workspace is
   created and she becomes its owner.
2. **Client & project** — Dashboard → New client (“Globex”), then New project
   (currency, dates, budget). `/projects/:id` is the project workspace.
3. **Invite the client** — Project → Members → add Carl as `CLIENT_APPROVER`
   (he must accept a workspace invitation first).
4. **Baseline scope** — Scope ledger → New draft → add requirements (title,
   description, acceptance criteria, category, priority, order) → declare
   assumptions/exclusions → **Publish baseline**. The version freezes; history
   stays reconstructible forever.
5. **Change request** — Carl (or Olivia) creates a request from the project
   page, optionally with attachments.
6. **Triage** — Olivia classifies it (in-scope / potential change / duplicate /
   needs clarification) with a rationale, moving it `DRAFT → SUBMITTED →
   TRIAGING → ESTIMATING`.
7. **Assess** — Link affected baseline requirements (manual or drift-check),
   record impact (price, effort, timeline, risks, confidence).
8. **Send** — “Send for approval” freezes request + impact + links into a
   review package with named approvers and expiry. The API records a content
   checksum; any material edit invalidates the package and steps the workflow
   back.
9. **Decide** — Carl opens the review link (`/review/:token`, mobile-first),
   reads request/impact/related scope/assumptions, and approves, rejects, or
   requests changes with an explicit confirmation. The decision binds to the
   package checksum with actor/time metadata.
10. **Amend** — Olivia converts the approved change into a scope amendment
    draft and publishes it explicitly (amendments require a linked approved
    change), then marks the request implemented.
11. **Audit** — Activity shows every transition with actor/time/before-after
    and links to the primary record; decision notes capture rationale;
    evidence (URLs, files, notes) attaches to requirements with verification.

## Variations to demo

- **Invalidation:** edit the request after sending → package invalidates with a
  reason; resend a fresh package.
- **Bundles & dependencies:** group related requests into one commercial
  decision; `DEPENDS_ON` blocks sending/approving until the prerequisite is met
  (override needs a lead rationale).
- **AI assistance:** drift check with accept/dismiss links, clarification
  suggestions, proposal drafts, requirement extraction — all advisory, all
  reviewed, all logged.
- **Health & metrics:** `/health` explains pending/aging/unlinked work and
  delivery metrics; org metrics show weekly active projects.
