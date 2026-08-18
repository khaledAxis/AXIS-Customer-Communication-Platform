/**
 * Field validation for content items and newsletters.
 *
 * These rules run on the SERVER (services call them before any write). The UI may
 * mirror them for immediate feedback, but the server is the enforcement point —
 * CLAUDE.md: never trust the client.
 *
 * Messages are written for non-technical AXIS staff: no field names, no enum names,
 * no technical jargon.
 */

import { isSafeUrl } from "./richText";

export const LIMITS = {
  title: 200,
  summary: 500,
  body: 50_000,
  author: 120,
  sourceName: 120,
  url: 2_000,
  imageAlt: 200,
  campaignName: 150,
  subject: 200,
  preheader: 150,
} as const;

export interface FieldError {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: FieldError[];
}

function ok(errors: FieldError[]): ValidationResult {
  return { ok: errors.length === 0, errors };
}

function tooLong(field: string, label: string, max: number): FieldError {
  return { field, message: `${label} is too long — please keep it under ${max} characters.` };
}

export const LANGUAGES = ["HE", "AR", "UNKNOWN"] as const;
export type LanguageValue = (typeof LANGUAGES)[number];

export const REVIEW_STATES = ["NEW", "PENDING_REVIEW", "APPROVED", "REJECTED"] as const;
export type ReviewStateValue = (typeof REVIEW_STATES)[number];

export const ORIGINS = ["INTERNAL", "INGESTED"] as const;
export type OriginValue = (typeof ORIGINS)[number];

export interface ContentDraftInput {
  title: string;
  summary?: string | null;
  body?: string | null;
  language: string;
  origin?: string | null;
  externalUrl?: string | null;
  author?: string | null;
  sourceName?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  publishedAt?: string | null;
}

export function validateContentDraft(input: ContentDraftInput): ValidationResult {
  const errors: FieldError[] = [];

  const title = input.title?.trim() ?? "";
  if (title === "") {
    errors.push({ field: "title", message: "Please add a title." });
  } else if (title.length > LIMITS.title) {
    errors.push(tooLong("title", "The title", LIMITS.title));
  }

  if ((input.summary ?? "").length > LIMITS.summary) {
    errors.push(tooLong("summary", "The summary", LIMITS.summary));
  }
  if ((input.body ?? "").length > LIMITS.body) {
    errors.push(tooLong("body", "The article text", LIMITS.body));
  }
  if ((input.author ?? "").length > LIMITS.author) {
    errors.push(tooLong("author", "The author name", LIMITS.author));
  }
  if ((input.sourceName ?? "").length > LIMITS.sourceName) {
    errors.push(tooLong("sourceName", "The source name", LIMITS.sourceName));
  }
  if ((input.imageAlt ?? "").length > LIMITS.imageAlt) {
    errors.push(tooLong("imageAlt", "The image description", LIMITS.imageAlt));
  }

  if (!LANGUAGES.includes(input.language as LanguageValue)) {
    errors.push({ field: "language", message: "Please choose Hebrew, Arabic, or Not set." });
  }

  if (input.origin != null && input.origin !== "" && !ORIGINS.includes(input.origin as OriginValue)) {
    errors.push({ field: "origin", message: "Please choose whether this article is ours or external." });
  }

  const url = input.externalUrl?.trim();
  if (url) {
    if (url.length > LIMITS.url) {
      errors.push(tooLong("externalUrl", "The link", LIMITS.url));
    } else if (!isSafeUrl(url)) {
      errors.push({
        field: "externalUrl",
        message: "That link doesn't look right. Use a full address starting with https://",
      });
    }
  }

  const published = input.publishedAt?.trim();
  if (published && Number.isNaN(Date.parse(published))) {
    errors.push({ field: "publishedAt", message: "That date doesn't look right." });
  }

  return ok(errors);
}

export interface NewsletterDetailsInput {
  name: string;
  subject?: string | null;
  preheader?: string | null;
  language: string;
}

export function validateNewsletterDetails(input: NewsletterDetailsInput): ValidationResult {
  const errors: FieldError[] = [];

  const name = input.name?.trim() ?? "";
  if (name === "") {
    errors.push({ field: "name", message: "Please give this newsletter a name so you can find it later." });
  } else if (name.length > LIMITS.campaignName) {
    errors.push(tooLong("name", "The newsletter name", LIMITS.campaignName));
  }

  const subject = input.subject?.trim() ?? "";
  if (subject === "") {
    errors.push({ field: "subject", message: "Please add the email subject line." });
  } else if (subject.length > LIMITS.subject) {
    errors.push(tooLong("subject", "The subject line", LIMITS.subject));
  }

  if ((input.preheader ?? "").length > LIMITS.preheader) {
    errors.push(tooLong("preheader", "The preview text", LIMITS.preheader));
  }

  if (!LANGUAGES.includes(input.language as LanguageValue)) {
    errors.push({ field: "language", message: "Please choose Hebrew, Arabic, or Not set." });
  }

  return ok(errors);
}

/**
 * Content composition is locked once a newsletter leaves DRAFT (CLAUDE.md: a
 * campaign is editable only in DRAFT; submitting freezes content).
 */
export const EDITABLE_CAMPAIGN_STATUSES = ["DRAFT"] as const;

export function isCampaignEditable(status: string): boolean {
  return (EDITABLE_CAMPAIGN_STATUSES as readonly string[]).includes(status);
}

export class CampaignNotEditableError extends Error {
  constructor(status: string) {
    super(`This newsletter can no longer be edited because it is ${status.toLowerCase()}.`);
    this.name = "CampaignNotEditableError";
  }
}

export function assertCampaignEditable(status: string): void {
  if (!isCampaignEditable(status)) throw new CampaignNotEditableError(status);
}

/**
 * Deletion must never destroy sent history. Mirrors the database RESTRICT rules —
 * checked in the service so the user gets a friendly message instead of a DB error.
 */
export const DELETABLE_CAMPAIGN_STATUSES = ["DRAFT", "REJECTED", "CANCELED"] as const;

export function isCampaignDeletable(status: string, hasHistory: boolean): boolean {
  if (hasHistory) return false;
  return (DELETABLE_CAMPAIGN_STATUSES as readonly string[]).includes(status);
}
