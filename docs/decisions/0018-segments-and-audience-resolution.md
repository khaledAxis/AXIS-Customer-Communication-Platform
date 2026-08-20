# ADR-0018: Segments, audience resolution & explainable exclusions

- **Status:** Accepted
- **Date:** 2026-08-18
- **Deciders:** Administrator/developer (architect)
- **Relates to:** builds on ADR-0009 (email-centric delivery identity), ADR-0008 (unsubscribe /
  safe-send), ADR-0017 (the CRM projection this reads from).

## Context

The mirrored CRM had no way to answer "who should receive this newsletter". Staff needed to express
an audience — *GPS customers who own a Trimble product* — without knowing SQL, Prisma, Monday column
ids, or the internal enum names.

The data makes this harder than it sounds: one email address appears on up to four separate CRM
records, 993 of 2,638 records have no address at all, and the local communication state that decides
eligibility lives per *address*, not per CRM record.

## Decision

### 1. A segment stores rules, never SQL and never code

`Segment.criteria` holds a validated JSON rule tree. `parseSegmentDefinition` re-validates it on
**every read**, not only on write — a row can predate the current code or be edited by hand, which
makes it untrusted input like any other boundary.

The only fields and operators that exist are the ones in `segmentFields.ts`, and the only Prisma
clauses that can be produced are the ones written in `segmentQuery.ts`. An unknown operator cannot
reach the query layer; it is refused with a message naming the offending condition.

### 2. Boolean shape is deliberately limited

```
ALL of:
  - condition
  - condition
  - group (ANY | ALL of conditions that all share one scope)
```

One level of nesting, and **a group cannot mix scopes**. "ANY of [company is X, contact is Y]" has no
single clear meaning once a company has many contacts, so it is refused rather than silently
reinterpreted. Arbitrary nested boolean expressions were rejected: they make the builder unreadable
for the people it is for. The constraint lives in the parser, not the UI.

### 3. Matching semantics staff can predict

- **Company** and **product** conditions select companies. Product conditions combined with AND must
  be satisfied by **one** owned product — "a Trimble subscription expiring soon", not "a Trimble, and
  separately something expiring soon".
- **Contact** conditions select contacts; when company conditions exist a contact must also belong to
  a matching company.
- **Email-settings** conditions (language, consent, address check, unsubscribed, blocked) filter the
  resolved *address*. Failing them means **not in the segment** — it is matching, not exclusion.
- A segment says which address kinds to include: company campaign address, contact address, or both.
  The **accounting address has no code path** and cannot be selected (ADR-0009).

### 4. Two stages, never collapsed

```
CRM MATCHING            →  COMMUNICATION ELIGIBILITY
segmentQuery (database)    evaluateEligibility + resolveAudience (pure domain)
```

Audience resolution reuses the existing `resolveAudience`/`evaluateEligibility` domain code rather
than growing a second eligibility engine. A record can match a segment and still be excluded from
delivery, and the preview reports both numbers separately. Deduplication is unchanged: one delivery
per normalized email, every contributing CRM record retained as a source, duplicates counted in
`duplicateSourcesCollapsed` — never as exclusions.

### 5. Every exclusion has a reason, in words

The preview reports exclusions grouped by reason with a friendly label *and* what to do about it
("Add an address in Monday, then sync"), plus a per-address list. Nothing is dropped silently, and
the raw reason code is never shown. Counting matched companies happens **after** email-settings
filtering — reporting "1,215 companies matched" for a segment that selects nobody is technically
true and actively misleading.

### 6. Dynamic membership; a preview writes nothing

A saved segment stores the definition, never a member list, and is re-resolved every time it is
previewed. `previewAudience` creates no `CampaignRecipient`, no `CampaignEvent`, and reaches no mail
transport — a test asserts the audience source files contain no transport reference at all.

A newsletter may reference a segment (`Campaign.segmentId`, already in the schema). "Record this
audience" writes exactly two tables — `CampaignAudienceSnapshot` and `CampaignAudienceExclusion` —
as a DRAFT-time planning record, replacing any previous snapshot for that campaign so a stale
audience can never look current. The authoritative, immutable send-time snapshot and the production
delivery ledger belong to the send workflow and are **not** created here.

### 7. Lookup values are stored by label

Classification, industry and product type conditions carry the Monday **label**, not a database id:
labels are what staff recognise, they survive a lookup row being recreated, and they keep a stored
segment readable.

## Alternatives Considered

- **A general query builder with arbitrary nesting.** Rejected — the users are not technical, and the
  extra power buys nothing the AXIS use cases need.
- **Storing a resolved member list.** Rejected — audiences must reflect the CRM at send time, and a
  frozen list would quietly email people who have since unsubscribed.
- **A separate eligibility path for previews.** Rejected for the same reason preview and send share
  one renderer (ADR-0011): two implementations drift, and the difference would only show up in
  production.
- **Treating a failed email-settings condition as an exclusion.** Rejected — it would report
  thousands of "exclusions" for a segment the user deliberately narrowed, burying the exclusions
  that actually need action.

## Consequences

Measured against the real CRM (1,215 companies / 1,423 contacts / 1,319 addresses):

| Segment | Companies | Contacts | CRM sources | Unique addresses | Excluded |
| --- | ---: | ---: | ---: | ---: | ---: |
| Everything | 1,215 | 1,423 | 2,638 | 1,319 | 996 |
| Classification = GPS | 469 | 661 | 1,130 | 607 | 387 |
| Classification = scanner | 30 | 34 | 64 | 32 | 23 |
| Owns a Trimble product | 49 | 140 | 189 | 93 | 59 |
| Subscription expiring ≤ 90 days | 6 | 13 | 19 | 12 | 4 |
| Hebrew / Arabic localized | 0 | 0 | 0 | **0** | — |

- Resolution is database-side and fast: the full 2,638-source baseline resolves in ~170 ms.
- **A localized send currently reaches nobody.** All 1,319 addresses have `language = UNKNOWN`, and
  the conservative rule excludes them from a Hebrew or Arabic newsletter. The UI states this on the
  field itself rather than hiding it. Setting language per address is the blocker for real sending,
  and an explicit admin override is a possible future ADR.
- 993 CRM records have no address and 3 have an unusable one; these appear as named exclusions with
  a fix ("correct it in Monday, then sync"), which turns the audience preview into a data-quality
  report as a side effect.
- Industry remains available but is set on only 70 companies; classification (622) and product
  ownership are the dimensions that work today.
