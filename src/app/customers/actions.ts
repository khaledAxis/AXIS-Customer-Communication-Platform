"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { syncCrmFromMonday } from "../../server/services/crmSyncService";
import { setLanguage } from "../../server/services/communicationService";

/**
 * Server action for the CRM sync button.
 *
 * READ-ONLY IMPORT FROM MONDAY. Thin: call the service, refresh, report. Nothing here
 * can write to Monday — the CrmSource port has no write method.
 */
export async function syncCrmAction(): Promise<void> {
  const summary = await syncCrmFromMonday();

  revalidatePath("/customers");
  revalidatePath("/");

  const params = new URLSearchParams(
    summary.ok
      ? {
          synced: "1",
          companies: String(summary.companies),
          contacts: String(summary.contacts),
          products: String(summary.products),
          customerProducts: String(summary.customerProducts),
          message: summary.message,
        }
      : { error: summary.message },
  );
  redirect(`/customers?${params.toString()}`);
}

/**
 * Assign communication language from the customer page.
 *
 * Language is the only local setting editable here. Consent, unsubscribe, blocked
 * state and the address check have no write path (ADR-0020), and Monday is never
 * touched — it has no language column at all.
 */
export async function setCustomerLanguageAction(formData: FormData): Promise<void> {
  const language = formData.get("language");
  const addressId = formData.get("addressId");
  const companyId = formData.get("companyId");
  if (typeof addressId !== "string") return;

  await setLanguage({ language, addressIds: [addressId] });

  if (typeof companyId === "string") revalidatePath(`/customers/${companyId}`);
  revalidatePath("/communication");
  revalidatePath("/segments");
}
