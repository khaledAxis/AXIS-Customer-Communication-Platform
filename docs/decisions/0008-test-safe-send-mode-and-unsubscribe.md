# ADR-0008: Test/Safe-send mode & locally-owned unsubscribe

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Administrator/developer (architect)
- **Relates to:** ADR-0004 (email provider), ADR-0007 (Monday sync — unsubscribe must survive sync)

## Context

Sending to real customers is the highest-risk operation in the platform. Two safety requirements are
now confirmed and must be enforced structurally, server-side:

1. Every customer-facing newsletter needs a **functional, public unsubscribe** mechanism, and
   unsubscribe state must be **locally owned** and **immune to CRM sync** (Monday is the CRM source of
   truth per ADR-0007, but it must never resurrect an unsubscribed recipient).
2. Early operation must run in a strict **TEST / SAFE-SEND** mode so that development, testing, and
   verification of segmentation/personalization **cannot** deliver mail to real CRM addresses.

## Decision

### Unsubscribe (locally owned, sync-immune)
- Every customer-facing newsletter **must** include a working unsubscribe link.
- On unsubscribe: **persist an `Unsubscribe` record**, make the recipient **immediately ineligible**
  for future newsletter sends, and **preserve unsubscribe history** for audit. `Unsubscribe` is
  **append-only** and **locally owned**; **no Monday CRM sync may overwrite or remove it** (per the
  ADR-0007 ownership boundary).
- The unsubscribe endpoint/link is **safe for public recipient use**: it **must not require login**,
  and it must use an unguessable, scoped token (no enumerable identifiers, no session).

### TEST / SAFE-SEND mode (default) vs PRODUCTION SEND mode
- The system runs in **TEST / SAFE-SEND mode by default**; production customer sending is **disabled
  by default**.
- While in TEST / SAFE-SEND mode:
  - **No email may be delivered to any real CRM customer address.**
  - **All** campaign and test deliveries go **only** to the configured safe-send address
    (`SAFE_SEND_REDIRECT_TO`, default **`khaled-s@axis-gps.com`**).
  - The **original intended recipient** is still resolved and retained in **internal
    preview/logging** (and on the recipient ledger) so segmentation and personalization can be
    verified — it is simply not used as the delivery address.
- **Switching to PRODUCTION SEND mode requires an explicit configuration/administrative action.** It
  must **never** happen automatically — not because tests pass, not because a campaign is approved.
- **Enforcement is server-side.** UI restrictions alone are insufficient; the send pipeline resolves
  the effective delivery address through the safe-send gate regardless of what any client requests.
- **The UI must clearly show the current mode** (`TEST MODE` vs `PRODUCTION SEND MODE`). In TEST
  MODE, the campaign confirmation UI must state that recipients are **simulated/previewed** and the
  actual email will be delivered **only** to `khaled-s@axis-gps.com`.
- Existing sending-safety controls (ADR/architecture) remain: recipients recomputed from **live
  eligibility** at send time, **idempotent per-(campaign, contact)** send ledger, typed confirmation
  with recipient count.

### Configuration
- `SEND_MODE` (`TEST` | `PRODUCTION`, default `TEST`) and `SAFE_SEND_REDIRECT_TO`
  (default `khaled-s@axis-gps.com`) are environment-configured (documented in `.env.example`), not
  hard-coded in application logic.

## Alternatives Considered

- **Rely on a test API key / sandbox from the email provider:** provider-specific, easy to misconfigure,
  and does not guarantee no real address is ever contacted. Rejected in favor of a server-side redirect
  gate we control.
- **UI-only "are you sure?" guard:** bypassable; violates the server-side enforcement principle.
- **Auto-enable production when a campaign is approved / tests pass:** exactly the accidental-mass-send
  path we must prevent. Rejected — the switch is always an explicit admin action.
- **Storing unsubscribe only in Monday:** would let a later sync overwrite it and risks mailing an
  unsubscribed recipient. Rejected — unsubscribe is locally owned and sync-immune.

## Consequences

- Accidental mass-send is structurally prevented in non-production: the default is safe, and going
  live is a deliberate, auditable act.
- The send pipeline has a single **safe-send gate** that resolves the effective recipient; test and
  production paths share eligibility, ledger, and idempotency logic (only the delivery address
  differs), keeping behavior consistent.
- Unsubscribe survives CRM sync by construction, satisfying consent obligations even though Monday is
  the CRM source of truth.
- **Required automated tests** (see `CLAUDE.md` → Testing Expectations and `docs/development-plan.md`):
  unsubscribed contact cannot receive a campaign; unsubscribe persists across CRM sync; TEST MODE
  cannot send to a real customer email; TEST MODE sends only to `khaled-s@axis-gps.com`; switching to
  production is explicit; duplicate-send protection holds in both modes.
- Mode and safe-send address are configuration; changing them is an operational decision, logged to
  the audit trail when toggled.
