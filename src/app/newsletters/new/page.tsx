import { createNewsletterAction } from "../actions";
import { NewsletterDetailsForm } from "../../../ui/NewsletterDetailsForm";
import { PageHeader } from "../../../ui/primitives";

export default function NewNewsletterPage() {
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
