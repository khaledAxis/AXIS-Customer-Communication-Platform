# ADR-0033: Windows Electron wrapper around the self-hosted Next.js application

- **Status:** Accepted
- **Date:** 2026-09-01
- **Deciders:** AXIS platform owner and development team

## Context

AXIS staff need to open the internal application from a Windows executable without
starting Next.js from a terminal each time. The application is not a static client: its
authentication, authorization, database access, CRM integration, rendering, and send
safety all live in the Next.js server. Moving those decisions into Electron would create
a second application boundary and weaken the existing controls.

The first wrapper build packaged `.next` and all of `node_modules` in `app.asar` and
attempted to spawn `next start` through `process.execPath`. A packaged Electron process
is not an ordinary Node executable by default, an ASAR path is not a suitable child
working directory, and the build intentionally contained no `.env.local`. The window
could therefore show a login page from another or stale local server while the packaged
server had no database or Auth.js configuration of its own.

## Decision

- Electron remains a thin, trusted shell. It loads the same server-rendered application
  from a loopback-only origin and gains no business capability of its own.
- Next.js builds with `output: "standalone"`. The traced server, its traced runtime
  dependencies, `public`, and `.next/static` assets are packaged outside `app.asar`.
  The packaged Electron executable starts `server.js` as a child in its bundled Node
  mode (`ELECTRON_RUN_AS_NODE=1`), with `NODE_PATH` pointing only at that external
  traced dependency directory. This avoids relying on a separately installed Node.
- The packaged app binds only to `127.0.0.1:3210`. Auth.js `AUTH_URL` and
  `NEXTAUTH_URL` are forced to that exact origin, and `AUTH_TRUST_HOST=true`.
- A single-instance lock and an explicit port-availability check prevent a new window
  from attaching to an unrelated process already listening on that port.
- The AXIS `BrowserWindow` can navigate only inside its exact `127.0.0.1` application
  origin. It creates no child windows. Credential-free external HTTP(S) links are
  delegated to the system browser; unexpected local origins, URL credentials, and all
  other schemes are refused.
- Secrets are never embedded. An administrator provisions `.env.local` in
  `%APPDATA%\AXIS Customer Communication Platform\`; process environment and an
  explicit `AXIS_DESKTOP_ENV_FILE` remain controlled diagnostic alternatives.
- `DATABASE_URL` and `AUTH_SECRET` are mandatory at startup. Missing configuration,
  an unavailable database, or a failed server produces an explicit desktop error rather
  than a misleading login screen.
- The wrapper always sets `PRODUCTION_DELIVERY_ENABLED=false`. Desktop packaging is not
  an activation mechanism, and startup makes no email-provider call.
- `npm run desktop:smoke` is the repeatable packaged acceptance check. It refuses any
  non-test database, uses the prepared synthetic account, blanks every live email/CRM
  credential, proves the bundled server and login flow, and requests a clean shutdown.
- Electron main-process files remain CommonJS because `package.json` does not declare
  ESM and Electron loads the `main` entry in CommonJS mode. ESLint applies a narrow
  override only for the TypeScript-oriented `no-require-imports` rule.

## Alternatives Considered

- **Static-export the UI into Electron:** rejected because Server Components, Server
  Actions, Auth.js, Prisma, and route handlers require the server runtime.
- **Bundle `.env.local` in the EXE:** rejected because it would distribute database and
  integration secrets in an extractable artifact.
- **Package all dependencies and spawn `next start` from `app.asar`:** rejected because
  the child runtime and ASAR working-directory assumptions are brittle and the artifact
  is unnecessarily large.
- **Electron `utilityProcess.fork`:** rejected after packaged smoke showed that the call
  can stall on this Windows packaging path even while the child begins starting. The
  bundled Node child is directly waitable and terminable and uses the same Electron
  executable already shipped with the app.
- **Load a deployed HTTPS instance:** remains the preferred future operating model for
  multiple staff machines, but no stable internal deployment was in scope for this
  checkpoint.

## Consequences

- A workstation needs a one-time administrator configuration and network access to the
  configured PostgreSQL server.
- Double-click startup is deterministic and reports configuration/server failures before
  accepting credentials.
- A renderer link cannot replace the trusted AXIS application with arbitrary content or
  gain a second Electron window; ordinary web links remain available through the user's
  default browser.
- The executable remains a packaging option for the existing single Next.js deployable;
  it is not a second implementation and does not change any domain or sending invariant.
- A future shared deployment can replace the local server wrapper with a remote HTTPS
  origin through a superseding ADR.
