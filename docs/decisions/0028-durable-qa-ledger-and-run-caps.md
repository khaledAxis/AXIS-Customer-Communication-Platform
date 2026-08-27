# ADR-0028 — A durable, delete-protected QA ledger and explicit QA runs

- **Status:** Accepted
- **Date:** 2026-08-24
- **Amends:** [ADR-0027](0027-qa-email-allowlist.md), which stored QA sends on `CampaignTestSend`
- **Does NOT change:** the SAFE TEST hard-lock, the four-address QA allowlist, production delivery

## Context

Twenty real QA emails were sent on 2026-08-24 and all twenty were accepted. An
integration suite's `afterAll` then deleted the ledger rows recording them.

The lost history was the smaller problem. The QA send caps — 10 per recipient, 40 in
total — are computed by **counting those rows**. Deleting them did not merely erase a
record; it silently restored permission to send twenty more emails to colleagues who
had already received five each. A cleanup routine handed back quota.

Three properties of ADR-0027 combined to make this possible:

1. QA sends shared `CampaignTestSend`, a table integration suites legitimately clean.
2. The cleanup was written as "delete the QA rows for this campaign" — a filter that
   happened to match rows the suite had never created.
3. The quota was derived from whatever the table currently held, with no notion of a
   record being *real*.

## Decision

### 1. A dedicated pair of tables

`QaEmailRun` and `QaEmailSend` replace the use of `CampaignTestSend`. No test touches
these models, and `qaEmailService.ts` no longer contains the string `campaignTestSend`
at all — asserted by test. Sharing a table with routinely-cleaned data was the root
cause, and the fix is to stop sharing it.

### 2. LIVE and TEST_FIXTURE are different kinds of record

`QaRecordOrigin` is `LIVE` or `TEST_FIXTURE`. A LIVE row **may not carry a
`fixtureOwner`** and a fixture row **must** carry one; both are enforced in the
repository, which refuses the write rather than accepting it. Consequently a LIVE row
can never match a fixture-scoped delete — not by mistake, and not on purpose.

### 3. Deletion is structurally scoped

`deleteFixtures(owner)` is the **only** delete path. It pins
`origin: TEST_FIXTURE` **and** the caller's owner token, and refuses an empty owner
rather than matching everything. There is no `deleteAll`, no function taking a raw
`where`, and no way to name a LIVE row for deletion. `deleteMany({})` against the QA
ledger is not expressible.

### 4. Quota counts LIVE rows only, from the database, every time

`countLiveSends` filters `origin: LIVE`. Fixture rows are invisible to it, so a test
can neither consume a real recipient's quota nor pretend it is empty. There is no
in-memory counter, so a restart cannot reset anything — and a test asserts the source
holds none.

`SENDING` and `UNCERTAIN` consume quota; `FAILED` does not. An unknown outcome may have
been delivered, so quota fails towards "enough has been sent".

### 5. `providerMessageId` is written once

`recordResult` refuses a row that already carries one, and the column is UNIQUE. A
provider acceptance is evidence about a specific message in a specific inbox; letting a
later write replace it would make the ledger unable to answer the only question it
exists to answer. A duplicate id from a provider is recorded as `UNCERTAIN` rather than
allowed to escape as an exception.

### 6. Runs are opened deliberately, and never reset the caps

A send requires an OPEN run. A run is created only by `openQaRun`, which requires
`MANAGE_USERS` and — when live sends already exist — an explicit acknowledgement that
**starting a new run does not reset the limits**. Nothing creates one implicitly: not a
restart, not a test, not a ledger change, not an environment toggle.

Caps are **lifetime per recipient**, not per run. Opening a run cannot buy more quota.

### 7. Under the test runner, sends attach only to a pinned fixture run

Suites share a database and run in parallel. `findOpenRunForSending` therefore returns,
under vitest, only the fixture run pinned by `setQaFixtureOwnerForTesting` for that
worker — never a LIVE run, even if one is open. Without this, a lifecycle test in one
suite opening a LIVE run would silently make a *different* suite's sends LIVE.

Outside the test runner the rule inverts: only a LIVE run is eligible, so a stray
fixture run in an operational database can never carry a real send.

## The 2026-08-24 run

The twenty rows were reconstructed by `scripts/recover-qa-ledger-20260824.mjs`, a
committed and idempotent script. Every recipient, scenario, provider message id and
acceptance timestamp was transcribed verbatim from the output of the run itself. **No
provider id was generated.**

Each row carries `ledgerRecovered = true` and a `recoveryNote`, and a
`QA_LEDGER_RECOVERED` audit entry records the provenance and the reason. The ledger
never presents these as rows written at send time, and the UI badges them `recovered`.

Reconstruction was chosen over a bare `historicalLiveSendCount = 20` baseline because
the per-recipient evidence exists and is exact: a baseline would have preserved the
total while losing which colleague received what.

## Consequences

- The caps now tell the truth: 20 / 40 total, 5 / 10 per recipient.
- A cleanup routine cannot lower a real count, and a database delete cannot restore
  quota.
- **Automated tests still share the operational development database
  (`axis_ccp_dev`).** This ADR mitigates it with strict fixture ownership, but does not
  remove it, and it remains a HIGH-severity finding: a dedicated test database is the
  real fix and is the recommended next step.

## Alternatives considered

**Keep `CampaignTestSend` and write a more careful cleanup.** Rejected. The incident
happened because a correct-looking filter matched rows it did not own; a more careful
filter is the same class of control that already failed.

**A `historicalLiveSendCount` baseline instead of rows.** Rejected: the per-recipient
evidence exists, and a baseline would discard it.

**Let tests write LIVE rows and clean them up.** Rejected — that is precisely the
arrangement that caused the incident.
