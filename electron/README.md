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
assets, and static chunks are packaged as ordinary resources so Electron's isolated
Node utility process can start `server.js`; the UI loads only
`http://127.0.0.1:3210`. A second instance focuses the first one, and a port conflict
is reported rather than attaching to an unknown local server.

The wrapper always forces `PRODUCTION_DELIVERY_ENABLED=false`. It does not provide a
second customer-delivery activation path and never calls an email provider at startup.

## Why `require` is used

Electron loads `electron/main.js` from the package's `main` field. This package is
CommonJS (there is no `"type": "module"`), so Node/Electron built-ins and the small
runtime helpers use `require`. ESLint keeps checking these files with only the
TypeScript-specific `no-require-imports` rule disabled for `electron/**/*.js`.
