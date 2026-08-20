import { createContentAction } from "../actions";
import { ContentForm } from "../../../ui/ContentForm";
import { PageHeader } from "../../../ui/primitives";
import { Capability, requirePageCapability } from "../../../server/auth/session";

export default async function NewContentPage() {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePageCapability(Capability.MANAGE_CONTENT, "/content/new");
  return (
    <>
      <PageHeader
        title="Write an article"
        description="Add a title, a short summary and the text. You can add a picture and a link to the original article too."
      />
      <ContentForm action={createContentAction} submitLabel="Save article" />
    </>
  );
}
