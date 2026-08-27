"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import * as qaReviewService from "../../../../server/services/qaReviewService";

/**
 * Records one human rendering observation (ADR-0030).
 *
 * Nothing here sends. The form carries a message id, a check key, a verdict and an
 * optional note — there is no recipient field and no transport reachable from this
 * action, so a review can never become a resend.
 */
export async function recordReviewAction(formData: FormData): Promise<void> {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : null;
  };

  const sendId = text("sendId");
  const checkKey = text("checkKey");
  const status = text("status");
  if (!sendId || !checkKey || !status) return;

  const result = await qaReviewService.recordReviewCheck({
    sendId,
    checkKey,
    status,
    severity: text("severity"),
    note: text("note"),
  });

  revalidatePath("/admin/qa-email/review");
  redirect(
    result.ok
      ? `/admin/qa-email/review?saved=1#${sendId}`
      : `/admin/qa-email/review?error=${encodeURIComponent(result.message)}`,
  );
}
