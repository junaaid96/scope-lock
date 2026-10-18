# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| `main` HEAD (pre-1.0, 0.x) | Yes |
| Older commits/tags | No — please verify against `main` first |

ScopeLock is pre-1.0; security fixes land on `main` only.

## Reporting a vulnerability

Email **codejborg@junaidul.pro.bd** with:

- What is affected (API route, package, UI page) and the commit you tested.
- Steps to reproduce or a minimal proof of concept.
- The impact as you see it (who can do what they should not be able to do).

Please do **not** open a public issue, pull request, or discussion for a
suspected vulnerability, and do not include real credentials, tokens, private
keys, or client data in your report — redact them first.

You will get an acknowledgement within 72 hours. Once a fix is ready it ships
on `main` with a CHANGELOG entry; embargo details stay private until the fix
is published. If you want credit, say so and how you would like to be named.

## Scope notes

- Reportable: authentication/authorization bypasses, IDOR, token/session
  handling, injection, SSRF, secrets exposure, broken cryptography, audit-log
  tampering, and insecure defaults in the Docker/self-host path.
- Out of scope: denial of service against shared demo infrastructure,
  vulnerabilities in upstream dependencies without a ScopeLock-specific
  exploit path (still welcome as a regular dependency-update PR), and missing
  hardening headers on deployments you configure yourself.

## Self-host checklist (highlights)

- Serve the API over HTTPS behind your reverse proxy; keep `SESSION_*`,
  `TOTP_*`, `OTP_*`, `WEBHOOK_*`, OAuth, and WebAuthn secrets out of the
  web image and out of `VITE_*` variables.
- Use the direct (non-pooler) `DATABASE_URL` for migrations/transactions and
  restrict database network access to the API host.
- Set `EMAIL_HTTP_ENDPOINT` / provider keys only in the API environment, and
  review `docs/OPERATIONS.md` before exposing intake, inbound-email, or
  webhook endpoints to the internet.
