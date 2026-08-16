# `src/domain` — Pure business logic

The **pure** core of the system: TypeScript types, enums/constants, business invariants, the campaign
**state machine**, **eligibility** and **completeness** predicates, segment-resolution rules, and
import **row classification**.

**Rules**
- **No I/O.** Must not import Prisma, `fetch`, `next/*`, or any framework/vendor code.
- Depends only on `src/lib` (pure utilities).
- Everything here is **unit-testable without a database**. Invariants live here so they can be tested
  exhaustively (including illegal transitions and edge cases: no email, `UNKNOWN` language, duplicates).
- **No magic strings** — statuses, roles, languages, email/consent states, and row classes are enums
  or `as const` unions defined here and reused everywhere.

See `docs/architecture.md` §2 and `CLAUDE.md` (Domain Rules).
