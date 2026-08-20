# ADR-0023: Credentials authentication, server-enforced roles and enforced four-eyes approval

- **Status:** Accepted (implements ADR-0003)
- **Date:** 2026-08-20
- **Deciders:** Administrator/developer, AXIS management

## Context

ADR-0003 chose Auth.js for authentication and nothing implemented it. Every milestone
since has attributed work to one hard-coded stand-in, `dev-local@axis-gps.invalid`,
whose `passwordHash` column literally contained the string
`"not-a-real-credential-auth-arrives-in-a-later-milestone"`.

That stand-in is now the blocker. ADR-0022 built the four-eyes production approval —
creator ≠ approver, manager or administrator, administrators not exempt — and had to
report it **BLOCKED**, because a platform where every action belongs to the same
fictional account cannot tell two employees apart. A safety control that cannot
identify anyone proves nothing.

Two further problems were carried forward from ADR-0022 and are settled here:

- a rapid double click on "Prepare final audience" created two append-only snapshots;
- readiness re-resolved ~1,130 CRM records on every page load, and repeated loads were
  enough to make a development server stop responding.

The application is also reached over the office LAN by IP, so "it is only on my
machine" was never a security model.

## Decision

### 1. Auth.js v5 with Credentials, JWT sessions, and no new user tables

`next-auth@5.0.0-beta.32` — it declares `next: ^16.0.0`, which is what this project
runs, and it is the library ADR-0003 already selected. A Credentials provider is the
whole story: this is an internal tool for a handful of AXIS staff, there is no identity
provider to federate to, and **there is no public registration to protect**.

Auth.js does not support database sessions with the Credentials provider, so sessions
are JWTs. That is also what keeps the existing `User` model authoritative: no
`Account`, `Session` or `VerificationToken` tables were added.

**The token carries a user id and nothing else.** No role, no name, no email. Every
authorization decision re-reads the user row, so a role change or a deactivation takes
effect on the person's very next request rather than whenever their token happens to
expire. A stale claim inside a signed token is exactly the failure mode that makes
"deactivate this user" quietly not work.

### 2. Argon2id, via prebuilt native bindings

`@node-rs/argon2` at the OWASP baseline (19 MiB, 2 iterations, 1 lane). Argon2id is
the memory-hard, side-channel-resistant variant recommended for password storage, and
this binding ships prebuilt binaries — including `win32-x64` — so there is no compiler
toolchain requirement on the machine AXIS actually uses.

`server/auth/password.ts` exposes `hashPassword` and `verifyPassword` and nothing else.
There is no `decrypt`, and a test asserts no exported name ever suggests one.
`verifyPassword` returns `false` rather than throwing for a corrupted, truncated, or
non-Argon2 stored value, so a damaged row is a failed login rather than a 500 that
tells an attacker something interesting.

`UNUSABLE_PASSWORD_HASH` is a deliberately invalid value for accounts that must exist
for historical references but must never authenticate.

### 3. The session Data Access Layer is the security boundary

`server/auth/session.ts` is the one place the application learns who is acting. It
loads the row, refuses deactivated and system accounts, and is memoised per request
with React `cache()` — a page that asks five times costs one query, and `cache()` is
scoped to one render, so it can never leak one person's identity into another's
request.

`src/proxy.ts` (Next.js 16 renamed `middleware` to `proxy`) redirects anonymous traffic
to `/login` before a page renders, including requests arriving from another machine on
the LAN. It is explicitly **not** the boundary: it only checks that a session cookie
exists. Both the Next.js authentication guide and CLAUDE.md say the same thing — the
real check belongs next to the data, and it is `requireCapability` inside each service.

Four paths are public, each for a reason: `/login`, `/setup`, `/api/auth/*`, and
`/api/media/*`. The last one serves newsletter images, and a recipient's email client
is anonymous by definition — requiring a session there would break every picture in a
delivered newsletter. Cloudinary-hosted images never touch this application at all.

### 4. One capability matrix, asked rather than re-derived

`domain/auth/authorization.ts` lists every distinct thing a signed-in person can do and
maps roles to them once. Services ask `assertCan`; they never write
`if (role === "ADMIN")`. MANAGER runs the communication business end to end; ADMIN adds
**exactly one** capability, `MANAGE_USERS`, and a test asserts the difference is
exactly that one — "administrator" must not quietly become a way around a business
rule.

Deactivated and system accounts hold **no** capability regardless of role: role is what
someone may do, `isActive` is whether they may act at all.

### 5. No public registration, and a self-closing bootstrap

There is no sign-up page, action or route. Accounts are created only at
`/admin/users`, only by an administrator.

That leaves the first administrator. `/setup` creates exactly one, and its gate is
`hasRealAdministrator()` — active, role ADMIN, **not** a system account — evaluated
*inside the creating transaction*, so two people opening the page simultaneously cannot
both succeed. Once one exists the page redirects and the service throws, permanently.
There is no flag to unset and no environment variable that reopens it.

We considered seeding from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (placeholders for
which already existed in `.env.example`) and **rejected it**: it puts a real staff
password into a file, an environment, a shell history and quite possibly a backup. The
placeholders were removed and replaced with a note explaining why. The owner types
their password once, into their own browser, and it is hashed before it reaches the
database.

### 6. The development stand-in is retired, not promoted and not deleted

On first bootstrap, `dev-local@axis-gps.invalid` is marked `isSystemAccount`,
deactivated, and given the unusable hash. Its historical campaigns, approvals and audit
rows are untouched.

It is **not** promoted to the first real administrator, and old rows are **not**
rewritten to name whoever logs in first. Doing either would fabricate a record of who
did what. Existing campaigns stay legacy development campaigns; a real four-eyes test
uses a new campaign created by a real person.

### 7. Four-eyes is now enforced, not reported

`approveForProduction` derives the approver from the session, runs `evaluateFourEyes`,
and **refuses** when the approver is the creator — including when the approver is an
administrator. The refusal is the service's, not a hidden button's: the readiness page
also disables the control and explains why, but a crafted request gets the same answer.

Approvals record `authenticatedActor: true`. Rows written before this milestone keep
`false`, so a historical approval can never retroactively satisfy the rule.

### 8. Final-audience preparation is idempotent per intent

`CampaignFinalAudience` gains `preparationKey` with
`@@unique([campaignId, preparationKey])`. The browser generates one token per intent
and resends it on a double click or a retried POST; the duplicate collides at the
database and returns the snapshot that already exists. Five concurrent requests produce
one snapshot, and the four that lose read the winner's figures back rather than
assuming them.

Append-only history is **preserved**: a later, deliberate preparation carries a fresh
token and creates a new snapshot, exactly as before. A `NULL` key never collides, so a
server-side caller with no browser still gets one snapshot per call.

### 9. Readiness skips work only when it is provably safe

`CampaignFinalAudience.resolutionWatermark` stores a cheap fingerprint — row count plus
newest timestamp — of **every** table the audience resolution reads: `Company`,
`Contact`, `CompanyContact`, `Product`, `CustomerProduct`, `CompanyProduct`,
`Industry`, `CustomerClassification`, `CommunicationAddress`, `Unsubscribe`,
`Suppression`, plus the campaign's own language and segment and that segment's rules.

When the stored watermark still matches, nothing that could move a person in or out has
been written since the snapshot was frozen, so the frozen result **is** the current one
and the full resolution is skipped. Any mismatch — and any snapshot predating the
column, which carries an empty string — re-resolves in full.

**The optimisation can only ever fail towards doing more work.** It is never a cache of
a *conclusion*; it is a proof that the inputs have not moved. Tests assert the
watermark changes for an unsubscribe, a suppression, a language change, a consent
change, a new CRM record and an edited segment, and that an unauthenticated caller is
still refused whether the shortcut was taken or not.

### 10. Everything else is unchanged

SAFE TEST still runs `axisgpscana@gmail.com → khaled-s@axis-gps.com` with
`Reply-To: noreply@axis-gps.com`, now behind a signed-in staff member. Unsubscribe is
still footer-only, with no `List-Unsubscribe` header. **Production customer sending is
still not implemented**, and the readiness checklist still reports it BLOCKED.

## Alternatives Considered

- **A custom session/token system.** Rejected: this is the category where writing your
  own is a known way to get it subtly wrong, and ADR-0003 had already chosen Auth.js.
- **bcrypt.** Adequate, but Argon2id is the current recommendation and bcrypt silently
  truncates at 72 bytes, which quietly weakens exactly the long passphrases the policy
  encourages. A test asserts long passphrases are not truncated.
- **Storing role in the JWT.** Rejected. It is one fewer query and it breaks
  deactivation and role changes until the token expires.
- **Database sessions.** Not supported by Auth.js with Credentials, and would add
  tables duplicating `User`.
- **Environment-variable admin seeding.** Rejected — see §5.
- **Promoting `dev-local` to the first administrator.** Rejected — see §6.
- **Letting an administrator self-approve.** Rejected: that is the exemption ADR-0022
  already refused, and implementing authentication in order to weaken it would be
  perverse.
- **Caching readiness results.** Rejected in favour of the watermark: a cached
  *conclusion* can be stale, a fingerprint of the *inputs* cannot mislead in the unsafe
  direction.
- **Redis for the sign-in throttle.** Rejected as infrastructure bought before a
  milestone proved the need (ADR-0005). The in-process limiter's limitations are
  documented in the module rather than hidden.

## Consequences

**Positive**

- Four-eyes production approval is now a real control: two identities, enforced
  server-side, administrators included.
- Every audit row, campaign creator, consent record and frozen audience names a real
  person from here on.
- Deactivating an account takes effect on that person's next request, with their
  history intact.
- LAN access is protected; an unauthenticated request from another machine reaches
  `/login` and nothing else.
- A double-clicked preparation is one snapshot, and readiness no longer re-resolves the
  whole CRM on every page load.

**Negative / follow-ups**

- `next-auth@5` is still a beta. It is the maintained v5 line, declares support for
  Next 16, and is pinned to an exact version so an upgrade is deliberate.
- **`mustChangePassword` is recorded but not yet enforced.** An administrator-issued
  password is flagged and shown in the admin list, but nothing yet forces the owner to
  change it at next sign-in. Stated here rather than implied.
- The sign-in throttle is per-process and keyed by email. It resets on restart, is not
  shared across instances, and does not stop a spray across many accounts from one IP —
  that belongs at a reverse proxy.
- There is no password reset by email, because there is no transactional email path
  that is not the newsletter sender. An administrator sets a new password instead.
- The weak-password list is a handful of obvious entries, not a breach corpus.
- No multi-factor authentication, and no session-revocation list: a stolen token stays
  valid until it expires or the account is deactivated. Deactivation is the lever.
- `setActorForTesting` exists as a seam for integration tests. It throws outside a test
  runner, and the real request path never consults it — but it is a seam, and it is
  named honestly.
