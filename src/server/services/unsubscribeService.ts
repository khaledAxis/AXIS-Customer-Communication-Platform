import "server-only";

import {
  TEST_UNSUBSCRIBE_TOKEN,
  UNSUBSCRIBE_INVALID_MESSAGE,
  UNSUBSCRIBE_TEST_LINK_MESSAGE,
  hashUnsubscribeToken,
  isTestUnsubscribeToken,
  looksLikeUnsubscribeToken,
  mintUnsubscribeToken,
  type TokenRejection,
} from "../../domain/unsubscribe/unsubscribeToken";
import { getPrisma } from "../db/prisma";
import { consumeUnsubscribeProbe } from "../auth/rateLimit";
import { unsubscribeUrlFor } from "./publicUrlConfig";

/**
 * Public, no-login unsubscribe (ADR-0024).
 *
 * A recipient holds a 32-byte random secret that carries no data. This service turns
 * it into an address, and — only on an explicit confirmation — records a global
 * unsubscribe for that one address.
 *
 * Three properties this file exists to guarantee:
 *
 *  1. **Nothing the browser says is trusted.** No email, address id, campaign id or
 *     contact id is accepted from the request. The token is the only input, and every
 *     fact comes from the row it matches.
 *  2. **A failure reveals nothing.** Unknown token, revoked token, malformed token and
 *     throttled request all produce the same sentence, so the endpoint cannot be used
 *     to discover which addresses AXIS holds.
 *  3. **It is idempotent.** `Unsubscribe` is unique on (normalizedEmail, scope), so a
 *     refresh, a double click or a retried POST records the same single fact.
 *
 * The actor is deliberately NULL on the audit row: a recipient is not an AXIS staff
 * member, and inventing an authenticated user for a public action would put a
 * colleague's name on something a customer did.
 */

export type UnsubscribeLookup =
  | {
      ok: true;
      /** Shown to nobody — the page never displays the address it resolved. */
      normalizedEmail: string;
      alreadyUnsubscribed: boolean;
    }
  | { ok: false; reason: TokenRejection; message: string };

const INVALID: UnsubscribeLookup = {
  ok: false,
  reason: "UNKNOWN",
  message: UNSUBSCRIBE_INVALID_MESSAGE,
};

const TEST_LINK: UnsubscribeLookup = {
  ok: false,
  reason: "TEST_TOKEN",
  message: UNSUBSCRIBE_TEST_LINK_MESSAGE,
};

/**
 * Resolves a token WITHOUT changing anything.
 *
 * This is what a GET does. Following a link — including a mail client's link
 * prefetcher, a security scanner, or a corporate proxy that opens every URL in an
 * email — must never unsubscribe anybody. That is why the write lives behind a POST.
 */
export async function lookupUnsubscribeToken(
  rawToken: unknown,
  options: { clientKey?: string } = {},
): Promise<UnsubscribeLookup> {
  // A fixed preview link from a SAFE TEST message. It resolves to nothing at all, so
  // an internal test email can never touch a customer's settings.
  if (typeof rawToken === "string" && isTestUnsubscribeToken(rawToken)) {
    return TEST_LINK;
  }

  if (!looksLikeUnsubscribeToken(rawToken)) {
    // Shape is wrong: refuse before touching the database, and count it as a probe.
    consumeUnsubscribeProbe(options.clientKey ?? "unknown");
    return INVALID;
  }

  // Throttle only INVALID lookups (below). A genuine recipient's first attempt is
  // never refused, which is the rule this endpoint must not break.
  const row = await getPrisma().unsubscribeToken.findUnique({
    where: { tokenHash: hashUnsubscribeToken(rawToken) },
    select: { normalizedEmail: true, revokedAt: true },
  });

  if (!row || row.revokedAt !== null) {
    if (!consumeUnsubscribeProbe(options.clientKey ?? "unknown")) {
      return { ok: false, reason: "RATE_LIMITED", message: UNSUBSCRIBE_INVALID_MESSAGE };
    }
    return INVALID;
  }

  const existing = await getPrisma().unsubscribe.count({
    where: { normalizedEmail: row.normalizedEmail, scope: "GLOBAL" },
  });

  return {
    ok: true,
    normalizedEmail: row.normalizedEmail,
    alreadyUnsubscribed: existing > 0,
  };
}

export type UnsubscribeResult =
  | { ok: true; alreadyUnsubscribed: boolean }
  | { ok: false; reason: TokenRejection; message: string };

/**
 * Records the unsubscribe. The ONLY write path in this service.
 *
 * Reached only from an explicit confirmation. Everything is derived from the token
 * row: the address, the campaign it was sent with, and the communication profile it
 * belongs to.
 */
export async function confirmUnsubscribe(
  rawToken: unknown,
  options: { clientKey?: string } = {},
): Promise<UnsubscribeResult> {
  if (typeof rawToken === "string" && isTestUnsubscribeToken(rawToken)) {
    // A preview link changes nothing, ever — not even when confirmed.
    return { ok: false, reason: "TEST_TOKEN", message: UNSUBSCRIBE_TEST_LINK_MESSAGE };
  }

  if (!looksLikeUnsubscribeToken(rawToken)) {
    consumeUnsubscribeProbe(options.clientKey ?? "unknown");
    return INVALID;
  }

  const prisma = getPrisma();
  const token = await prisma.unsubscribeToken.findUnique({
    where: { tokenHash: hashUnsubscribeToken(rawToken) },
  });

  if (!token || token.revokedAt !== null) {
    consumeUnsubscribeProbe(options.clientKey ?? "unknown");
    return INVALID;
  }

  const address = await prisma.communicationAddress.findUnique({
    where: { normalizedEmail: token.normalizedEmail },
    select: { id: true },
  });

  const now = new Date();
  const alreadyUnsubscribed = await prisma.$transaction(async (tx) => {
    const existing = await tx.unsubscribe.findUnique({
      where: {
        normalizedEmail_scope: {
          normalizedEmail: token.normalizedEmail,
          scope: "GLOBAL",
        },
      },
      select: { id: true },
    });

    if (!existing) {
      await tx.unsubscribe.create({
        data: {
          normalizedEmail: token.normalizedEmail,
          scope: "GLOBAL",
          source: "RECIPIENT_LINK",
          reason: "Recipient used the unsubscribe link in a newsletter.",
          occurredAt: now,
          communicationAddressId: address?.id ?? token.communicationAddressId ?? null,
          campaignId: token.campaignId,
          tokenId: token.id,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "UNSUBSCRIBE",
          // NULL on purpose: this was a recipient, not an AXIS employee. A public
          // action must stay distinguishable from a staff action in the trail.
          actorUserId: null,
          entityType: "CommunicationAddress",
          entityId: address?.id ?? null,
          fromState: "SUBSCRIBED",
          toState: "UNSUBSCRIBED",
          reason: "Recipient self-service unsubscribe",
          metadata: {
            normalizedEmail: token.normalizedEmail,
            campaignId: token.campaignId,
            source: "RECIPIENT_LINK",
            // Records WHICH token was used without recording the token itself.
            unsubscribeTokenId: token.id,
            actor: "PUBLIC_RECIPIENT",
          },
        },
      });
    }

    // Usage is recorded whether or not this was the first time, so a repeated click
    // is visible in the trail without producing a second unsubscribe.
    await tx.unsubscribeToken.update({
      where: { id: token.id },
      data: {
        firstUsedAt: token.firstUsedAt ?? now,
        lastUsedAt: now,
        useCount: { increment: 1 },
      },
    });

    return existing !== null;
  });

  return { ok: true, alreadyUnsubscribed };
}

// ---------------------------------------------------------------------------
// Minting (server-side only — never reachable from a browser)
// ---------------------------------------------------------------------------

export interface IssuedUnsubscribeLink {
  /** The full URL for the newsletter footer, or null when no public origin exists. */
  url: string | null;
  /** The secret. Returned once, to be embedded and then forgotten. */
  token: string;
  tokenId: string;
}

/**
 * Issues a token for one destination of one campaign.
 *
 * Only the hash is stored, so this value can never be recovered afterwards — which is
 * why it is minted at the moment the message is rendered for that recipient, and not
 * earlier.
 */
export async function issueUnsubscribeLink(input: {
  normalizedEmail: string;
  campaignId: string | null;
  communicationAddressId?: string | null;
  purpose?: "PRODUCTION" | "FIXTURE";
}): Promise<IssuedUnsubscribeLink> {
  const { token, tokenHash } = mintUnsubscribeToken();

  const row = await getPrisma().unsubscribeToken.create({
    data: {
      tokenHash,
      normalizedEmail: input.normalizedEmail,
      campaignId: input.campaignId,
      communicationAddressId: input.communicationAddressId ?? null,
      purpose: input.purpose ?? "PRODUCTION",
    },
    select: { id: true },
  });

  return { url: unsubscribeUrlFor(token), token, tokenId: row.id };
}

/**
 * The unsubscribe URL a SAFE TEST or preview message carries.
 *
 * Constant, so the rendered HTML is byte-identical across renders and the ADR-0013
 * approval hash keeps matching. It resolves to nothing and unsubscribes nobody.
 */
export function testUnsubscribeUrl(): string | null {
  return unsubscribeUrlFor(TEST_UNSUBSCRIBE_TOKEN);
}
