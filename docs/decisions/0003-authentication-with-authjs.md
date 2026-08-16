# ADR-0003: Authentication & authorization with Auth.js + server-side RBAC

- **Status:** Accepted
- **Date:** 2026-08-16
- **Deciders:** Administrator/developer (architect)

## Context

The application is an **internal** tool for a small, known set of AXIS staff (administrator/developer
and company managers). It needs authentication and **role-based authorization** enforced on the
server, including a **four-eyes** rule for campaign approval (a creator must not approve their own
campaign). There is no requirement yet for customer-facing accounts, SSO, or MFA. The brief proposes
Auth.js.

## Decision

Use **Auth.js (NextAuth v5)** with a **credentials provider** (email + password) for the MVP.
- Roles are `ADMIN` and `MANAGER`, stored on the `User` record; the model allows adding roles later
  without redesign.
- **Authorization is enforced server-side in services** (and mirrored in route/layout guards only for
  UX). Every non-public route/action requires a valid session.
- **Four-eyes** approval is a server-side check (`createdById !== approverId` for managers; ADMIN may
  override for setup/emergencies).
- Passwords are hashed (bcrypt/argon2 — decided at implementation). The initial admin is seeded from
  environment variables; **no credentials are committed**.

## Alternatives Considered

- **OAuth/SSO (Google Workspace, Entra ID):** better long-term for staff SSO, but adds provider setup
  and is unnecessary for the MVP's small user set. Auth.js keeps the door open to add providers later.
- **Rolling our own session/auth:** avoidable security risk; Auth.js is well-trodden and integrates
  with Next.js.
- **Clerk/Auth0 (hosted):** external dependency and cost not justified for an internal tool at this
  scale; also keeps user data off-platform.

## Consequences

- Simple, self-contained auth suitable for internal use; upgrade path to SSO/MFA remains open.
- Credentials auth means we own password storage and reset flows (password reset is a later
  enhancement); must hash properly and rate-limit login.
- RBAC and four-eyes must be covered by tests that attempt UI-bypass (calling services directly).
- Added at the **Authentication milestone (M2)**, after the database foundation (M1).
