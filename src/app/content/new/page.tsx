import { createContentAction } from "../actions";
import { ContentForm } from "../../../ui/ContentForm";
import { PageHeader } from "../../../ui/primitives";

export default function NewContentPage() {
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
