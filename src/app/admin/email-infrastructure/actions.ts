"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { refreshDomainStatus } from "../../../server/services/emailInfrastructureService";

/**
 * Server actions for the email-infrastructure screen.
 *
 * There is exactly ONE action, and it READS. Nothing on this screen can enable
 * sending, change a switch, edit DNS, or write a credential: those live in the
 * environment and in the DNS zone, deliberately out of reach of any browser.
 */
export async function checkDomainAction(): Promise<void> {
  const result = await refreshDomainStatus();
  revalidatePath("/admin/email-infrastructure");

  redirect(
    result.ok
      ? "/admin/email-infrastructure?checked=1"
      : `/admin/email-infrastructure?error=${encodeURIComponent(result.message)}`,
  );
}
