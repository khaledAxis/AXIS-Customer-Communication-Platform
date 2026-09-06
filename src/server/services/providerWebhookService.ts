import "server-only";
import { getProductionEmailProvider } from "../integrations/email";
import { ingestProviderEvent } from "./providerEventService";

/** The adapter verifies exact signed bytes before any persistence or event effect. */
export async function receiveProviderWebhook(rawBody: string, headers: Record<string, string | undefined>) {
  const verification = getProductionEmailProvider().verifyWebhook({ rawBody, headers });
  if (!verification.ok) return { status: 401, body: { ok: false } };
  let applied = 0;
  for (const event of verification.events) {
    const outcome = await ingestProviderEvent(event);
    if (outcome.ok && !outcome.duplicate) applied++;
  }
  return { status: 200, body: { ok: true, applied } };
}
