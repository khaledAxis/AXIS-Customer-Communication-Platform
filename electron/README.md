# Desktop wrapper

This folder contains the Electron wrapper that lets the internal AXIS application run
from a Windows executable. Electron is only a trusted desktop window: it starts the
same production Next.js server on `127.0.0.1`, and every authentication, authorization,
database, and send-safety decision remains server-side.

## One-time workstation configuration

The EXE never contains `.env.local` or any secret. An administrator provisions the
existing server configuration once in the signed-in Windows user's application-data
directory:

```text
%APPDATA%\AXIS Customer Communication Platform\.env.local
```

From a checked-out development repository, this command installs the existing
`.env.local` there without printing its values:

```bash
npm run desktop:configure
```

After that one-time step, the portable EXE can be opened directly from File Explorer.
If `DATABASE_URL` or `AUTH_SECRET` is unavailable, or PostgreSQL cannot be reached, the
app shows a startup error instead of presenting a login screen that cannot work.

`AXIS_DESKTOP_ENV_FILE` may point at a different administrator-provisioned file for
diagnostics or automated validation. An explicit missing path fails closed and never
falls back to another file.

## Development and build

Run the wrapper with the development server:

```bash
npm run desktop:dev
```

Build the Windows portable EXE:

```bash
npm run desktop:build
```

The production build uses Next.js `output: "standalone"`. The traced server, public
assets, and static chunks are packaged as ordinary resources so the packaged Electron
executable's bundled Node mode can start `server.js`; the UI loads only
`http://127.0.0.1:3210`. A second instance focuses the first one, and a port conflict
is reported rather than attaching to an unknown local server.

The AXIS window may navigate only within that exact loopback origin. New windows are
always denied; credential-free external `http`/`https` links open in the Windows
default browser. Other schemes, URL credentials, and unexpected local origins are
refused.

The wrapper always forces `PRODUCTION_DELIVERY_ENABLED=false`. It does not provide a
second customer-delivery activation path and never calls an email provider at startup.

Run the repeatable packaged login smoke after `desktop:build`:

```bash
npm run desktop:smoke
```

The script requires the already migrated and synthetically seeded `TEST_DATABASE_URL`,
starts the portable EXE with every live email and CRM adapter disabled, checks the
visible login and a real Auth.js sign-in using the synthetic E2E account, and requests
a clean app shutdown. It refuses `axis_ccp_dev` and never prints credentials. Prepare a
fresh fixture set with `npm run test:db:migrate` followed by `node e2e/seed.mjs`.

## Why `require` is used

Electron loads `electron/main.js` from the package's `main` field. This package is
CommonJS (there is no `"type": "module"`), so Node/Electron built-ins and the small
runtime helpers use `require`. ESLint keeps checking these files with only the
TypeScript-specific `no-require-imports` rule disabled for `electron/**/*.js`.
