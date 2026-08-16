# `src/server` — Server-only code

The only place that performs **I/O**: application services, database access, and external
integrations. Never imported by client components.

Subdirectories (created as their milestone arrives):

- **`services/`** — the application layer. One use-case per function; orchestrates `domain` +
  persistence + integration ports; owns transactions; enforces authorization and invariants
  server-side. Routes/Server Actions call services, never the DB or providers directly.
- **`db/`** — Prisma client singleton and repositories (Milestone 1). The **only** code that imports
  Prisma. `domain` and UI never touch it.
- **`integrations/`** — external adapters behind internal **ports** (`EmailProvider`,
  `ContentSource`). Vendor-specific code is confined here (Milestones 9+, ADR-0004).

See `docs/architecture.md` §2/§4/§6 and `CLAUDE.md` (Architecture Rules).
