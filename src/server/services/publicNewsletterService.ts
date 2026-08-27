import "server-only";

import { randomBytes } from "node:crypto";

import {
  renderNewsletterHtml,
  type NewsletterDocument,
} from "../../domain/email/newsletterTemplate";
import {
  PUBLIC_NEWSLETTER_PATH,
  isWellFormedPublicToken,
  publicNewsletterUrl,
} from "../../domain/newsletter/publicPage";
import { validatePublicAppUrl } from "../../domain/unsubscribe/publicUrl";
import { Capability, requireCapability } from "../auth/session";
import { getPrisma } from "../db/prisma";
import { buildNewsletterDocument } from "./newsletterService";

/**
 * The hosted web version of a newsletter (ADR-0032).
 *
 * Most mail clients block images by default, so "View as webpage" is the one reliable
 * way a recipient sees the newsletter as designed. That link is only worth having if
 * the page behind it is real, per-newsletter, and openable with no account.
 *
 * What this page is NOT: an admin surface. It renders the SAME document the email
 * renders and nothing else — no status, no audience figures, no recipient data, no
 * controls. A visitor holding the URL learns exactly what a recipient of the email
 * would learn, and nothing more.
 */

/** The configured public origin, or null when it is unusable. */
function publicOrigin(): string | null {
  const result = validatePublicAppUrl(process.env.PUBLIC_APP_URL, {
    allowDevelopmentOrigins: true,
  });
  return result.ok ? result.origin : null;
}

/**
 * 32 CSPRNG bytes, base64url — the same strength as the unsubscribe token.
 *
 * It carries no data: no campaign id, no name, no date. A modified token resolves to
 * nothing at all rather than to a different newsletter, and the URL reveals nothing
 * about how many campaigns exist or when they were made.
 */
function mintPublicToken(): string {
  return randomBytes(32).toString("base64url");
}

export type PublicPageResult =
  | { ok: true; url: string | null; token: string; message: string }
  | { ok: false; reason: string; message: string };

/**
 * Switches on the public web version for a newsletter, returning its URL.
 *
 * Idempotent: a campaign keeps the token it already has, so the URL printed in an
 * email that has already gone out never stops working.
 */
export async function enablePublicPage(campaignId: string): Promise<PublicPageResult> {
  const actor = await requireCapability(Capability.MANAGE_NEWSLETTERS);
  const prisma = getPrisma();

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, publicToken: true },
  });
  if (!campaign) {
    return { ok: false, reason: "NOT_FOUND", message: "That newsletter no longer exists." };
  }

  if (campaign.publicToken) {
    return {
      ok: true,
      token: campaign.publicToken,
      url: publicNewsletterUrl(publicOrigin(), campaign.publicToken),
      message: "This newsletter already has a web version.",
    };
  }

  const token = mintPublicToken();
  await prisma.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id: campaignId },
      data: {
        publicToken: token,
        publicPageEnabledAt: new Date(),
        publicPageEnabledById: actor.id,
      },
    });
    await tx.auditLog.create({
      data: {
        action: "ADMIN_CHANGE",
        actorUserId: actor.id,
        entityType: "Campaign",
        entityId: campaignId,
        toState: "PUBLIC_PAGE_ENABLED",
        // The token itself is not recorded: it is the URL, and an audit row is a
        // less protected place than the campaign row.
        metadata: { publicPageEnabled: true },
      },
    });
  });

  return {
    ok: true,
    token,
    url: publicNewsletterUrl(publicOrigin(), token),
    message: "Web version created.",
  };
}

/** Turns the web version off. The token is dropped, so the old URL stops resolving. */
export async function disablePublicPage(campaignId: string): Promise<PublicPageResult> {
  const actor = await requireCapability(Capability.MANAGE_NEWSLETTERS);
  const prisma = getPrisma();

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { publicToken: null, publicPageEnabledAt: null, publicPageEnabledById: null },
  });
  await prisma.auditLog.create({
    data: {
      action: "ADMIN_CHANGE",
      actorUserId: actor.id,
      entityType: "Campaign",
      entityId: campaignId,
      toState: "PUBLIC_PAGE_DISABLED",
      metadata: { publicPageEnabled: false },
    },
  });

  return { ok: true, token: "", url: null, message: "Web version turned off." };
}

/** The public URL for a campaign, or null when there is no usable one. */
export async function publicUrlForCampaign(campaignId: string): Promise<string | null> {
  const campaign = await getPrisma().campaign.findUnique({
    where: { id: campaignId },
    select: { publicToken: true },
  });
  return publicNewsletterUrl(publicOrigin(), campaign?.publicToken ?? null);
}

export interface PublicPageState {
  /** A web version exists — the page resolves. */
  enabled: boolean;
  /**
   * The address the EMAIL would carry, or null when it would be dead in an inbox.
   * This is the deliverability rule and it is not negotiable.
   */
  emailUrl: string | null;
  /**
   * The address that resolves for whoever is looking at this screen right now,
   * including a development origin. Never used in an email.
   */
  inspectUrl: string | null;
}

/**
 * Three states, not two.
 *
 * A web version can exist while the configured origin is one no recipient could
 * reach — which is exactly the situation on a development machine. Collapsing that
 * into "no web version yet" tells an operator something false about their own data,
 * and hides the page they just created. So this reports existence and reachability
 * SEPARATELY, and the screen says which of the three it is.
 */
export async function getPublicPageState(campaignId: string): Promise<PublicPageState> {
  const campaign = await getPrisma().campaign.findUnique({
    where: { id: campaignId },
    select: { publicToken: true },
  });
  const token = campaign?.publicToken ?? null;
  if (!token) return { enabled: false, emailUrl: null, inspectUrl: null };

  const origin = publicOrigin();
  return {
    enabled: true,
    emailUrl: publicNewsletterUrl(origin, token),
    // Built without the deliverability gate on purpose: this one is for a person
    // sitting at the machine, and it is never rendered into a message.
    inspectUrl: origin ? `${origin.replace(/\/+$/, "")}${PUBLIC_NEWSLETTER_PATH}/${token}` : null,
  };
}

/**
 * The public URL of a campaign identified by NAME rather than by id.
 *
 * Exists for the QA scenario catalogue, which is source code and therefore cannot
 * carry a database id: a cuid from one machine means nothing on another. A QA
 * scenario names the campaign whose web version it is demonstrating, and this
 * resolves it at send time.
 *
 * It applies exactly the same deliverability gate as every other caller — an origin
 * a recipient could not reach yields null, and the link is then omitted rather than
 * shipped dead. A production campaign never uses this path: its own page comes from
 * its own id.
 */
export async function publicUrlForCampaignNamed(name: string): Promise<string | null> {
  const campaign = await getPrisma().campaign.findFirst({
    where: { name },
    select: { publicToken: true },
    orderBy: { createdAt: "desc" },
  });
  return publicNewsletterUrl(publicOrigin(), campaign?.publicToken ?? null);
}

export interface PublicNewsletterView {
  subject: string;
  language: string;
  /** The rendered newsletter, identical to the email body. */
  html: string;
}

/**
 * Resolves a public token to a rendered newsletter. NO AUTHENTICATION.
 *
 * Deliberately narrow: it selects only what the document needs, so there is no path
 * from this function to campaign status, audience figures, recipients or audit data.
 * A malformed token is refused before the database is touched, and an unknown one
 * returns null — the caller renders the same "not available" page for both, so the
 * route never becomes an oracle for which newsletters exist.
 */
export async function getPublicNewsletter(
  token: unknown,
): Promise<PublicNewsletterView | null> {
  if (!isWellFormedPublicToken(token)) return null;

  const prisma = getPrisma();
  const campaign = await prisma.campaign.findUnique({
    where: { publicToken: token },
    include: {
      contentLinks: {
        where: { isIncluded: true },
        orderBy: { position: "asc" },
        include: { contentItem: true },
      },
    },
  });
  if (!campaign || !campaign.publicToken) return null;

  const document: NewsletterDocument = {
    ...buildNewsletterDocument(campaign as Parameters<typeof buildNewsletterDocument>[0]),
    // The page IS the web version, so it never links to itself.
    viewInBrowserUrl: null,
    // Never the TEST banner: this page is what a recipient sees, and the banner is an
    // internal signal about how the platform is configured.
    isTestMode: false,
  };

  return {
    subject: document.subject,
    language: document.language,
    html: renderNewsletterHtml(document),
  };
}
