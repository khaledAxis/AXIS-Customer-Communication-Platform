import {
  assertCampaignEditable,
  isCampaignDeletable,
  validateNewsletterDetails,
  type FieldError,
} from "../../domain/content/contentValidation";
import { evaluateCampaignReadiness, type SelectedContent } from "../../domain/content/contentReadiness";
import {
  renderNewsletterHtml,
  renderNewsletterText,
  type NewsletterDocument,
  type NewsletterItem,
} from "../../domain/email/newsletterTemplate";
import { resolveDelivery } from "../../domain/send/safeSend";
import { applyTestSubjectPrefix } from "../../domain/send/testEmailApproval";
import {
  AUTHORIZED_TEST_RECIPIENT,
  AUTHORIZED_TEST_SENDER,
  testSendAvailability,
  testSendConfig,
} from "../../domain/send/testSendPolicy";
import * as repo from "../db/repositories/campaignRepository";
import { getPrisma } from "../db/prisma";
import { getNewsletterBrand, getViewInBrowserUrl } from "./brandConfig";

/**
 * Newsletter use-cases (application layer).
 *
 * Composition is multi-content and ordered by `CampaignContentItem.position`.
 * Preview and any future send both go through `buildNewsletterDocument` +
 * `renderNewsletterHtml`, so there is exactly one email rendering path.
 */

function fail(errors: FieldError[]): { ok: false; errors: FieldError[] } {
  return { ok: false, errors };
}

/**
 * Development author stand-in.
 *
 * `Campaign.createdById` is a required FK and authentication (Auth.js) is a later
 * milestone. Until then newsletters are attributed to a clearly-labelled local user
 * so the workflow is usable; this is replaced by the real session user, not extended.
 */
const DEV_USER_EMAIL = "dev-local@axis-gps.invalid";

export async function getAuthoringUserId(): Promise<string> {
  const prisma = getPrisma();
  const existing = await prisma.user.findUnique({ where: { email: DEV_USER_EMAIL } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: {
      email: DEV_USER_EMAIL,
      name: "Local development user",
      role: "ADMIN",
      passwordHash: "not-a-real-credential-auth-arrives-in-a-later-milestone",
    },
  });
  return created.id;
}

export interface NewsletterDetailsPayload {
  name: string;
  subject: string;
  preheader?: string | null;
  language: string;
}

export async function createNewsletter(input: NewsletterDetailsPayload) {
  const validation = validateNewsletterDetails(input);
  if (!validation.ok) return fail(validation.errors);

  const createdById = await getAuthoringUserId();
  const campaign = await repo.createCampaign({
    name: input.name.trim(),
    subject: input.subject.trim(),
    preheader: input.preheader?.trim() || null,
    language: input.language as "HE" | "AR" | "UNKNOWN",
    // status defaults to DRAFT and sendMode defaults to TEST at the database level.
    creator: { connect: { id: createdById } },
  });
  return { ok: true as const, data: campaign };
}

export async function updateNewsletterDetails(id: string, input: NewsletterDetailsPayload) {
  const validation = validateNewsletterDetails(input);
  if (!validation.ok) return fail(validation.errors);

  const campaign = await repo.getCampaign(id);
  if (!campaign) return fail([{ field: "id", message: "That newsletter no longer exists." }]);
  assertCampaignEditable(campaign.status);

  const updated = await repo.updateCampaign(id, {
    name: input.name.trim(),
    subject: input.subject.trim(),
    preheader: input.preheader?.trim() || null,
    language: input.language as "HE" | "AR" | "UNKNOWN",
  });
  return { ok: true as const, data: updated };
}

export async function addContent(campaignId: string, contentItemId: string) {
  const campaign = await repo.getCampaign(campaignId);
  if (!campaign) return fail([{ field: "id", message: "That newsletter no longer exists." }]);
  assertCampaignEditable(campaign.status);

  if (campaign.contentLinks.some((link) => link.contentItemId === contentItemId)) {
    return fail([{ field: "contentItemId", message: "That article is already in this newsletter." }]);
  }

  await repo.addContentToCampaign(campaignId, contentItemId);
  return { ok: true as const, data: { campaignId, contentItemId } };
}

export async function removeContent(campaignId: string, contentItemId: string) {
  const campaign = await repo.getCampaign(campaignId);
  if (!campaign) return fail([{ field: "id", message: "That newsletter no longer exists." }]);
  assertCampaignEditable(campaign.status);

  await repo.removeContentFromCampaign(campaignId, contentItemId);
  return { ok: true as const, data: { campaignId, contentItemId } };
}

export async function reorderContent(campaignId: string, orderedContentItemIds: string[]) {
  const campaign = await repo.getCampaign(campaignId);
  if (!campaign) return fail([{ field: "id", message: "That newsletter no longer exists." }]);
  assertCampaignEditable(campaign.status);

  await repo.reorderCampaignContent(campaignId, orderedContentItemIds);
  return { ok: true as const, data: { campaignId } };
}

/** Move one item up or down by one place — the friendly UI action. */
export async function moveContent(campaignId: string, contentItemId: string, direction: "UP" | "DOWN") {
  const campaign = await repo.getCampaign(campaignId);
  if (!campaign) return fail([{ field: "id", message: "That newsletter no longer exists." }]);
  assertCampaignEditable(campaign.status);

  const ordered = campaign.contentLinks.map((link) => link.contentItemId);
  const index = ordered.indexOf(contentItemId);
  if (index === -1) return fail([{ field: "contentItemId", message: "That article is not in this newsletter." }]);

  const target = direction === "UP" ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) {
    return { ok: true as const, data: { campaignId } }; // already at the edge — no-op
  }
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];

  await repo.reorderCampaignContent(campaignId, ordered);
  return { ok: true as const, data: { campaignId } };
}

export async function deleteNewsletter(id: string) {
  const campaign = await repo.getCampaign(id);
  if (!campaign) return fail([{ field: "id", message: "That newsletter no longer exists." }]);

  const history = await repo.campaignHistoryCount(id);
  if (!isCampaignDeletable(campaign.status, history > 0)) {
    return fail([
      {
        field: "id",
        message:
          "This newsletter has sending history, so it can't be deleted. Sent records are kept permanently.",
      },
    ]);
  }
  await repo.deleteCampaign(id);
  return { ok: true as const, data: { id } };
}

export async function duplicateNewsletter(id: string) {
  const campaign = await repo.getCampaign(id);
  if (!campaign) return fail([{ field: "id", message: "That newsletter no longer exists." }]);

  const createdById = await getAuthoringUserId();
  const copy = await repo.createCampaign({
    name: `${campaign.name} (copy)`,
    subject: campaign.subject,
    preheader: campaign.preheader,
    language: campaign.language,
    creator: { connect: { id: createdById } },
  });

  // Copy the composition in order; the new campaign starts as a fresh DRAFT in TEST mode.
  for (const link of campaign.contentLinks) {
    await repo.addContentToCampaign(copy.id, link.contentItemId);
  }
  return { ok: true as const, data: copy };
}

// ---------------------------------------------------------------------------
// Rendering — one canonical path shared by preview and any future sender
// ---------------------------------------------------------------------------

export interface NewsletterPreview {
  document: NewsletterDocument;
  html: string;
  text: string;
  readiness: ReturnType<typeof evaluateCampaignReadiness>;
  delivery: {
    from: string;
    to: string;
    intended: string;
    isRedirected: boolean;
    mode: string;
  };
  availability: ReturnType<typeof testSendAvailability>;
}

type CampaignWithContent = NonNullable<Awaited<ReturnType<typeof repo.getCampaign>>>;

export function buildNewsletterDocument(campaign: CampaignWithContent): NewsletterDocument {
  const items: NewsletterItem[] = campaign.contentLinks
    .filter((link) => link.isIncluded)
    .map((link) => ({
      // A frozen snapshot wins over the live item — sent history must stay reproducible.
      title: link.snapshotTitle ?? link.contentItem.title,
      summary: link.contentItem.summary,
      bodyHtml: link.snapshotBodyHtml ?? link.contentItem.bodyHtml,
      imageUrl: link.contentItem.imageUrl,
      imageAlt: link.contentItem.imageAlt,
      externalUrl: link.snapshotExternalUrl ?? link.contentItem.externalUrl,
      sourceName: link.contentItem.sourceName ?? link.contentItem.source?.name ?? null,
      customHeading: link.customHeading,
      customIntro: link.customIntro,
    }));

  return {
    subject: campaign.subject ?? campaign.name,
    preheader: campaign.preheader,
    language: campaign.language,
    items,
    brand: getNewsletterBrand(),
    viewInBrowserUrl: getViewInBrowserUrl(),
    // Not yet functional — the tokenized public endpoint arrives with sending (ADR-0008).
    unsubscribeUrl: null,
    isTestMode: campaign.sendMode === "TEST",
  };
}

/**
 * The document actually rendered for preview AND for sending.
 *
 * Keeping this in one place is what makes "what you approved is what is sent" true:
 * both paths call it, so the hashed message and the reviewed message cannot drift.
 */
export function previewDocument(campaign: CampaignWithContent): NewsletterDocument {
  const document = buildNewsletterDocument(campaign);
  if (campaign.sendMode !== "TEST") return document;
  return { ...document, subject: applyTestSubjectPrefix(document.subject) };
}

export async function getNewsletterPreview(id: string): Promise<NewsletterPreview | null> {
  const campaign = await repo.getCampaign(id);
  if (!campaign) return null;

  // The preview must show the EXACT message that would be submitted, including the
  // one-time [AXIS TEST] marker — otherwise the approved hash would not match what
  // the user reviewed. `previewDocument` is what both this page and the sender render.
  const document = previewDocument(campaign);

  const selected: SelectedContent[] = campaign.contentLinks.map((link) => ({
    contentItemId: link.contentItemId,
    position: link.position,
    isIncluded: link.isIncluded,
    origin: link.contentItem.origin,
    reviewState: link.contentItem.reviewState,
    hasSnapshot: link.snapshotAt !== null,
  }));

  // TEST mode: the resolver proves the provider destination is the safe address,
  // never a customer address. No email is produced or sent here.
  const delivery = resolveDelivery(AUTHORIZED_TEST_RECIPIENT, testSendConfig());

  return {
    document,
    html: renderNewsletterHtml(document),
    text: renderNewsletterText(document),
    readiness: evaluateCampaignReadiness({ selected }),
    delivery: {
      from: AUTHORIZED_TEST_SENDER,
      to: delivery.toEmail,
      intended: delivery.intendedEmail,
      isRedirected: delivery.isRedirected,
      mode: delivery.mode,
    },
    availability: testSendAvailability(),
  };
}

export const listNewsletters = repo.listCampaigns;
export const getNewsletter = repo.getCampaign;
export const countCampaignsByStatus = repo.countCampaignsByStatus;
