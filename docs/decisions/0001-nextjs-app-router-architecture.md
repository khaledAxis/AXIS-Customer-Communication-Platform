# ADR-0001: Next.js App Router as the application architecture

- **Status:** Accepted
- **Date:** 2026-08-16
- **Deciders:** Administrator/developer (architect)

## Context

We need a single, maintainable web application for internal AXIS staff: server-rendered admin UI,
form-heavy workflows (import, campaign building, approvals), server-side enforcement of business
rules, and a place to expose a webhook endpoint for the email provider. The team is small and the
scale is modest (~500–2,000 contacts). The brief proposes Next.js + TypeScript.

## Decision

Use **Next.js 16 with the App Router** and **TypeScript (strict)** as a **single deployable**.
- **Server Components by default**; `"use client"` only where interactivity requires it.
- **Server Actions / Route Handlers stay thin** — validate input, call a service, map the result.
  Business logic lives in `src/domain` (pure) and `src/server/services` (use-cases), never in routes.
- Enforce layering by **import direction** (`app → services → domain/db/integrations`).
- Path alias `@/*` → `src/*`. Tailwind CSS v4 for styling, RTL-aware from the start.

## Alternatives Considered

- **Next.js Pages Router:** older model; App Router is the current default with better server-side
  composition and colocated layouts (useful for RTL locale layouts).
- **Separate SPA (React/Vite) + standalone API (NestJS/Express):** two deployables, more boilerplate,
  and duplicated types across a network boundary — unjustified for an internal tool of this size.
- **Remix / SvelteKit / plain Node:** viable, but Next.js matches the brief, the team's familiarity,
  and the single-deployable goal with the least friction.

## Consequences

- One codebase and one deployment; shared TypeScript types end to end.
- Requires discipline to keep routes thin and business logic in `domain`/`services` — enforced by
  CLAUDE.md rules and the directory layout.
- Server Actions simplify forms but must always re-validate authz and invariants server-side.
- The single-process model is sufficient for MVP; long-running sends may later need a worker
  (see ADR-0005) without changing the domain layer.
