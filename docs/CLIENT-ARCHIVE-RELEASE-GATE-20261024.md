# L!nc Client Archive — Release Gate Findings

Date: 2026-10-24
Status: Evidence review only; **not confirmed as the deployed or approved client release**
Source reviewed: Library artifact `Linc_Updated_Source_for_Online_Testing.zip` (archive modified 2026-10-21). This is not a GitHub client commit and its contents must not be assumed to match Production.

## What was verified in the archive

- The client helper `src/services/api.ts` reads `linc_session_token` and attaches it as a Bearer token to same-origin API requests.
- `server.ts` issues a 32-byte random opaque session token, stores only its SHA-256 hash in the JSON-backed session map, and sets a 30-day expiry.
- `requireOwner` resolves the session's user and compares it to the requested user ID. The profile-read route uses this guard.
- `src/App.tsx` still stores `linc_current_user_id` as a convenience identifier and uses it in the profile restore URL. This ID must not be treated as proof of identity; the Bearer session must be validated by the server.
- The profile setup route accepts an `id` from the request body for a new profile, while requiring ownership when that ID already exists. Review the registration/identity-binding policy before release.
- Profile setup contains default guardian phone/LINE/display values and sets `guardianLinePairedAt` during setup. These values and a timestamp are not proof of a real guardian pairing. Remove demo defaults and only record pairing after a short-lived, single-use challenge is verified against the intended provider identity.
- The archive has a `bun.lock` file but no npm lockfile. The dependency diagnostic reports that `node_modules` is absent and the current environment cannot resolve `registry.npmjs.org` (`EAI_AGAIN`). The source-level security audit passes, but the API smoke test fails because no server is running at `127.0.0.1:3000`; this is not a test result against a deployed server.

## Architecture boundary

The archive contains a separate Express/Vite application and JSON-file persistence. The connected GitHub repository `jaiioffice-svg/linc-tech-ex-backend` is a separate backend codebase. Do not copy routes or assume session records are shared between these two applications. A successful static audit in the archive does not establish compatibility with the connected backend or verify a live deployment.

## Release gates before runtime integration

1. Identify and pin the approved client archive/repository and exact commit; compare it with the intended deployed build.
2. Choose one authoritative identity/session implementation. If retaining opaque sessions, keep random server-issued tokens, hashed server-side storage, expiry and revocation; ensure the store is durable and shared across instances before production.
3. Require a verified session for every user-owned read/write route. Derive ownership from the session, not from `userId` supplied by the client.
4. Remove fake guardian contact defaults and do not set pairing timestamps until provider identity and a single-use pairing challenge have been verified.
5. Add account A/B tests, invalid/expired/revoked-session tests, guardian-pairing tests, and payment fail-closed tests.
6. Reconcile the dependency manager: either build with a Bun version compatible with the committed `bun.lock`, or deliberately generate and commit the lockfile for the selected package manager. Do not claim the client build passes until a clean install, type-check and production build complete.
7. Test only against a disposable Preview database with synthetic accounts. No Production migration or deployment is authorized by this review.

## Scope and non-claims

This is a documentation-only evidence review. It changes no runtime code, secrets, database schema/data, LINE recipients, or Production deployment. It does not claim that the archive is the current release, that API smoke tests passed, or that the client is production-ready.
