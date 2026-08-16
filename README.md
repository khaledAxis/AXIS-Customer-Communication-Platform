# AXIS Customer Communication Platform

Internal web application for **AXIS GPS & Mapping Solutions** to manage customer communication:
import contacts (from Hashavshevet via Excel/CSV), organize them by industry / product / brand /
tags, build **segmented newsletters and campaigns** in **Hebrew and Arabic**, route them through a
**manager approval workflow**, and send them via an external email provider with delivery and
engagement tracking.

This is an **internal tool**, not a public SaaS product.

> **Status:** Foundation / Milestone 0. The engineering foundation and documentation are in place;
> feature modules are not implemented yet. See [`docs/development-plan.md`](docs/development-plan.md).

---

## Documentation

| Document | Purpose |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | Operating manual and engineering rules (read first) |
| [`docs/requirements.md`](docs/requirements.md) | Goals, users, functional & non-functional requirements, MVP scope, business rules |
| [`docs/architecture.md`](docs/architecture.md) | System components, boundaries, data flow, diagrams |
| [`docs/development-plan.md`](docs/development-plan.md) | Milestone plan (M0–M12) with Definition of Done |
| [`docs/decisions/`](docs/decisions/) | Architecture Decision Records (ADRs) |

## Technology Stack

Next.js 16 (App Router) · TypeScript 5 (strict) · React 19 · Tailwind CSS v4 · ESLint 9 ·
PostgreSQL + Prisma · Auth.js · Docker. See [`CLAUDE.md`](CLAUDE.md#technology-stack) for the full
list and what is intentionally **not** installed yet.

## Prerequisites

- **Node.js 20+** (developed on Node 24)
- **npm 10+**
- **Docker** (for local PostgreSQL, from the database milestone onward)

## Getting Started

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

> Database, migration, worker, and email scripts are added as their milestones land — see the
> development plan. Do not add infrastructure ahead of its milestone.

## Project Structure

See [`CLAUDE.md`](CLAUDE.md#repository-structure) for the authoritative structure. In short:
`src/app` (routes/UI), `src/domain` (pure business logic), `src/server` (services, DB, integrations),
`src/lib` (shared utilities), `src/ui` (reusable components), `docs/` (documentation), `prisma/`
(schema + migrations, added at the DB milestone).

## Security

No secrets are committed. All configuration comes from environment variables documented in
[`.env.example`](.env.example). See [`CLAUDE.md`](CLAUDE.md#security-rules).

## License

See [`LICENSE`](LICENSE).
