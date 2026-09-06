"use server";
import { revalidatePath } from "next/cache";
import { DeliveryError } from "../../../server/services/deliveryService";
import { NotAuthenticatedError, NotAuthorizedError } from "../../../domain/auth/authorization";
import { scheduleCustomerDelivery, rescheduleCustomerDelivery, resumeCustomerDelivery, cancelCustomerDelivery } from "../../../server/services/productionDispatchService";

export async function customerDeliveryAction(_previous: { ok: boolean; message: string }, form: FormData) {
  const id = form.get("campaignId");
  if (typeof id !== "string" || !id || id.length > 100) return { ok: false, message: "Choose a newsletter." };
  try {
    const confirmation = String(form.get("confirmation") ?? "");
    const time = new Date(String(form.get("scheduledAt") ?? ""));
    const operation = form.get("operation");
    if (operation === "schedule") await scheduleCustomerDelivery(id, confirmation, time);
    else if (operation === "reschedule") await rescheduleCustomerDelivery(id, confirmation, time);
    else if (operation === "resume") await resumeCustomerDelivery(id, confirmation);
    else if (operation === "cancel") await cancelCustomerDelivery(id);
    else return { ok: false, message: "Choose a delivery action." };
    revalidatePath(`/newsletters/${id}`); revalidatePath(`/newsletters/${id}/readiness`);
    revalidatePath("/operations"); revalidatePath("/reports");
    return { ok: true, message: operation === "cancel" ? "Scheduled delivery canceled." : "Delivery instruction recorded. Follow its progress in Reports." };
  } catch (error) {
    return { ok: false, message: error instanceof DeliveryError || error instanceof NotAuthenticatedError || error instanceof NotAuthorizedError
      ? error.message : "The delivery instruction could not be recorded. Reload and review its current state before trying again." };
  }
}
