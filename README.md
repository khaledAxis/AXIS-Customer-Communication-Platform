# AXIS Customer Communication Platform

Internal web application for **AXIS GPS & Mapping Solutions** to manage customer communication.
CRM master data lives in **Monday.com** (the source of truth); this platform is a **downstream
projection / read model** that mirrors contacts and companies for local use, organizes them by
industry / product / brand / tags, builds **segmented newsletters and campaigns** in **Hebrew and
Arabic**, routes them through a **manager approval workflow**, and sends them via an external email
provider with delivery and engagement tracking.

This is an **internal tool**, not a public SaaS product.

> **Status:** Foundation / Milestone 0. The engineering foundation and documentation are in place;
> feature modules are not implemented yet. See [`docs/development-plan.md`](docs/development-plan.md).

> **Data direction:** Monday.com → this platform is **read-only** in v1. The platform never writes
> CRM state back to Monday. Communication state (email validity, unsubscribe, suppression, campaigns,
> events, audit) is **owned locally** and is **never** overwritten by CRM sync. See
> [ADR-0007](docs/decisions/0007-monday-crm-source-of-truth.md).

> **Sending safety:** The system ships in **TEST / SAFE-SEND mode** by default. In this mode no email
> reaches real customers — every delivery is redirected to the configured safe-send address. Going to
> production sending is an explicit administrative action. See
> [ADR-0008](docs/decisions/0008-test-safe-send-mode-and-unsubscribe.md).

---

## Documentation

| Document | Purpose |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Operating manual and engineering rules (read first) |
| [`docs/requirements.md`](docs/requirements.md) | Goals, users, functional & non-functional requirements, MVP scope, business rules |
| [`docs/architecture.md`](docs/architecture.md) | System components, boundaries, data flow, diagrams |
| [`docs/development-plan.md`](docs/development-plan.md) | Milestone plan (M0–M13) with Definition of Done |
| [`docs/decisions/`](docs/decisions/) | Architecture Decision Records (ADRs) |

## Technology Stack

Next.js 16 (App Router) · TypeScript 5 (strict) · React 19 · Tailwind CSS v4 · ESLint 9 ·
PostgreSQL + Prisma · Auth.js · Docker · **Monday.com GraphQL API + webhooks** (CRM source of truth) ·
external email provider via HTTP API. See [`CLAUDE.md`](CLAUDE.md#technology-stack) for the full list
and what is intentionally **not** installed yet.

## How the system is operated

Normal users perform **all operational workflows through the application UI** — CRM sync, segmentation,
campaign building, approval, and sending. Terminal/CLI commands are for developers and infrastructure
only, never a required step in a business workflow. See [`CLAUDE.md`](CLAUDE.md#uiux-rules).

## Prerequisites

- **Node.js 20+** (developed on Node 24)
- **npm 10+**
- **Docker** (for local PostgreSQL, from the database milestone onward)
- **Monday.com API access** (token + board ids), from the CRM sync milestone onward

## Getting Started (developers)

```bash
# 1. Install dependencies
npm install

# 2. Create your local environment file from the template and fill in values
cp .env.example .env.local        # never commit .env / .env.local

# 3. Run the development server
npm run dev                       # http://localhost:3000
```

### Available scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | Lint with ESLint |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm test` | Unit tests (+ DB integration tests when `DATABASE_URL` is set) |
| `npm run db:deploy` | Apply `prisma/migrations` to the configured database |
| `npm run db:migrate` | Create/apply a dev migration (`prisma migrate dev`) |
| `npm run db:generate` | Regenerate the Prisma client |

### Local development database (developers only)

PostgreSQL is required (no SQLite). This is developer infrastructure — **not** part of the final
non-technical AXIS user workflow.

```bash
# 1. Start a local PostgreSQL dev service (requires Docker)
docker compose up -d                     # see compose.yaml (localhost-only, healthchecked)

# 2. Point Prisma at it (git-ignored; never commit real secrets)
echo 'DATABASE_URL="postgresql://axis:axis_dev_password@localhost:5432/axis_ccp_dev?schema=public"' >> .env.local

# 3. Apply the initial migration and run the full test suite
npm run db:deploy                        # applies prisma/migrations/…_init
npm test                                 # unit + integration tests
```

> The initial migration (`prisma/migrations/…_init`) is already generated and constraint-audited.
> Without a running PostgreSQL/`DATABASE_URL`, migration and integration tests are **BLOCKED**
> (integration suites self-skip) — never substitute SQLite.

## Project Structure

See [`CLAUDE.md`](CLAUDE.md#repository-structure) for the authoritative structure. In short:
`src/app` (routes/UI), `src/domain` (pure business logic), `src/server` (services, DB, integrations —
including the Monday `CrmSource` and email adapters), `src/lib` (shared utilities), `src/ui`
(reusable components), `docs/` (documentation), `prisma/` (schema + migrations, added at the DB
milestone).

## Security

No secrets are committed. All configuration comes from environment variables documented in
[`.env.example`](.env.example), including the Monday API token/webhook secret and the send-mode
settings. Sending safety is enforced **server-side**. See [`CLAUDE.md`](CLAUDE.md#security-rules).

## License

See [`LICENSE`](LICENSE).
