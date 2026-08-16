# ADR-0004: Email provider behind an internal port; vendor deferred

- **Status:** Accepted (vendor TBD)
- **Date:** 2026-08-16
- **Deciders:** Administrator/developer (architect)

## Context

Campaigns are sent through an **external transactional/bulk email provider via HTTP API** (the brief
explicitly rules out direct Gmail/Outlook SMTP). We must not couple domain logic to a specific
vendor, we need inbound **webhooks** (delivered/open/click/bounce/complaint/unsubscribe), and we need
strong **sending safety** (idempotency, eligibility recompute, test isolation). The specific vendor
is not yet chosen and depends on deliverability, pricing, and Hebrew/Arabic + RTL email handling.

## Decision

Define an internal **`EmailProvider` port** (interface) in `src/server/integrations`. Sending
use-cases depend only on this port; a single **vendor adapter** implements it and is the **only** code
aware of the vendor's SDK/HTTP shape.
- The port exposes send (single/batch), and the adapter normalizes provider **webhook** payloads into
  domain `CampaignEvent`s; hard bounces/complaints feed the suppression list (ADR path via M10).
- **No vendor SDK is added until the email milestone (M9).** The choice among **Resend / Postmark /
  Amazon SES** (or another) is deferred and will be recorded by updating this ADR.
- Provider credentials come from environment variables (least privilege); webhook signatures are
  verified; a non-production **environment guard** prevents real sends outside production.

## Alternatives Considered

- **Direct SMTP (Gmail/Outlook):** rejected by the brief; poor deliverability, no first-class
  webhooks/analytics, easy to trip spam limits.
- **Committing to one vendor now and using its SDK throughout:** couples domain to the vendor and
  forces a premature choice before deliverability/i18n evaluation.
- **A heavy generic email abstraction library:** unnecessary; a small purpose-built port is simpler
  and fully typed.

## Consequences

- Domain and services stay vendor-agnostic; switching providers means writing one adapter.
- The vendor decision is postponed to M9 with criteria: RTL/HE-AR rendering, deliverability
  (SPF/DKIM/DMARC for AXIS domains), webhook richness, bulk pricing, and suppression API.
- Requires a mapping layer from provider webhook formats to our normalized events.
- **Open question:** which provider and which sending domains/from-addresses (see requirements §11).
