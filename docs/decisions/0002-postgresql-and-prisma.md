# ADR-0002: PostgreSQL with Prisma ORM and migrations

- **Status:** Accepted
- **Date:** 2026-08-16
- **Deciders:** Administrator/developer (architect)

## Context

The domain is strongly relational (companies, contacts, taxonomy, segments, campaigns, recipients,
events, audit) and **data integrity is a hard requirement**: foreign keys, uniqueness (idempotent
send ledger, single active unsubscribe), enum constraints, and transactional multi-row mutations
(import commit, send + audit). Imported data is often incomplete, so the schema must allow many
nullable columns while still enforcing the few real invariants. The brief proposes PostgreSQL +
Prisma.

## Decision

Use **PostgreSQL** as the database and **Prisma** as the ORM and migration tool.
- **All schema changes go through Prisma migrations** — no manual DDL, no `db push` against anything
  but a throwaway local DB. Migrations are committed with the code that needs them.
- Enforce integrity **in the database**: FKs, `UNIQUE`, enums, `CHECK` where useful, and `NOT NULL`
  **only** for genuinely required fields (optional business metadata stays nullable — see ADR-0006).
- IDs are `cuid()`; every table has `createdAt`/`updatedAt`; audit/event tables are append-only.
- Database access is confined to `src/server/db`; `domain/` and UI never import Prisma.
- Local PostgreSQL runs in **Docker**; a separate test database backs integration tests.

## Alternatives Considered

- **Drizzle ORM:** lighter and SQL-first, but Prisma's migration ergonomics, typed client, and
  maturity better fit a small team prioritizing safety and clear migrations.
- **Raw SQL / query builder (Kysely):** maximum control but more boilerplate and manual typing; not
  justified at this scale.
- **MySQL/SQLite:** SQLite is too limited for concurrent writes and constraints we need; PostgreSQL's
  enums, partial indexes, and JSON support fit the requirements (e.g. `rawSource` audit JSON).

## Consequences

- Strongly-typed data access and a clear, reviewable migration history.
- Introduces Prisma as a dependency — added at the **Database milestone (M1)**, not before.
- Prisma's generated client must stay behind the `server/db` boundary to keep `domain/` pure.
- Requires Docker for local Postgres and a test DB in CI for integration tests.
