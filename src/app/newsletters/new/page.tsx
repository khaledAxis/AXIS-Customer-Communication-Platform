import { createNewsletterAction } from "../actions";
import { NewsletterDetailsForm } from "../../../ui/NewsletterDetailsForm";
import { PageHeader } from "../../../ui/primitives";
import { Capability, requirePageCapability } from "../../../server/auth/session";

export default async function NewNewsletterPage() {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePageCapability(Capability.MANAGE_NEWSLETTERS, "/newsletters/new");
  return (
    <>
      <PageHeader
        title="Create a newsletter"
        description="Give it a name and a subject line. You will choose the articles on the next screen."
      />
      <div className="max-w-2xl">
        <NewsletterDetailsForm action={createNewsletterAction} submitLabel="Create newsletter" />
      </div>
    </>
  );
}
