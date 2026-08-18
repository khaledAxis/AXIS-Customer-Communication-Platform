"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import type { ContentFormState } from "../app/content/actions";
import { ImageUploader } from "./ImageUploader";
import { RichTextEditor } from "./RichTextEditor";
import { Card, ErrorSummary, Field, buttonPrimary, buttonSecondary, inputClass } from "./primitives";

/**
 * Add / edit an article.
 *
 * Language is chosen first because it drives the writing direction of the editor
 * and the rendered newsletter.
 */

export interface ContentFormValues {
  id?: string;
  title?: string | null;
  summary?: string | null;
  body?: string | null;
  language?: string | null;
  origin?: string | null;
  sourceName?: string | null;
  author?: string | null;
  externalUrl?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  publishedAt?: Date | string | null;
}

type Action = (state: ContentFormState, formData: FormData) => Promise<ContentFormState>;

function asDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function ContentForm({
  action,
  values = {},
  submitLabel,
  savedMessage,
}: {
  action: Action;
  values?: ContentFormValues;
  submitLabel: string;
  savedMessage?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, errors: [] });
  const [language, setLanguage] = useState(values.language ?? "HE");
  const [origin, setOrigin] = useState(values.origin ?? "INTERNAL");

  const errorFor = (field: string) => state.errors.find((e) => e.field === field)?.message;

  return (
    <form action={formAction} className="space-y-6">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <ErrorSummary errors={state.errors} />

      {state.ok && savedMessage ? (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-800">{savedMessage}</p>
        </div>
      ) : null}

      <Card className="p-6">
        <div className="space-y-5">
          <Field
            label="Which language is this article written in?"
            hint="Hebrew and Arabic are written right-to-left, and the newsletter will follow automatically."
            required
            error={errorFor("language")}
          >
            <div className="flex flex-wrap gap-2">
              {[
                { value: "HE", label: "Hebrew — עברית" },
                { value: "AR", label: "Arabic — العربية" },
                { value: "UNKNOWN", label: "Not set yet" },
              ].map((option) => (
                <label
                  key={option.value}
                  className={`cursor-pointer rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${
                    language === option.value
                      ? "border-sky-600 bg-sky-50 text-sky-800 ring-1 ring-sky-600"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="language"
                    value={option.value}
                    checked={language === option.value}
                    onChange={() => setLanguage(option.value)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </Field>

          <Field label="Title" required error={errorFor("title")}>
            <input
              type="text"
              name="title"
              defaultValue={values.title ?? ""}
              required
              maxLength={200}
              dir={language === "HE" || language === "AR" ? "rtl" : "ltr"}
              placeholder="The headline readers will see"
              className={inputClass}
            />
          </Field>

          <Field
            label="Short summary"
            hint="One or two sentences shown under the title in the newsletter."
            error={errorFor("summary")}
          >
            <textarea
              name="summary"
              defaultValue={values.summary ?? ""}
              rows={3}
              maxLength={500}
              dir={language === "HE" || language === "AR" ? "rtl" : "ltr"}
              className={inputClass}
            />
          </Field>
        </div>
      </Card>

      <Card className="p-6">
        <Field
          label="Article text"
          hint="Select some text and use the buttons to add headings, bold, links or lists."
          error={errorFor("body")}
        >
          <RichTextEditor name="body" defaultValue={values.body ?? ""} language={language} />
        </Field>
      </Card>

      <Card className="p-6">
        <Field label="Picture" hint="Shown at the top of this article inside the newsletter.">
          <ImageUploader
            name="imageUrl"
            altName="imageAlt"
            defaultUrl={values.imageUrl}
            defaultAlt={values.imageAlt}
          />
        </Field>
      </Card>

      <Card className="p-6">
        <div className="space-y-5">
          <Field label="Where did this article come from?" error={errorFor("origin")}>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "INTERNAL", label: "We wrote it" },
                { value: "INGESTED", label: "From an external source" },
              ].map((option) => (
                <label
                  key={option.value}
                  className={`cursor-pointer rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${
                    origin === option.value
                      ? "border-sky-600 bg-sky-50 text-sky-800 ring-1 ring-sky-600"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="origin"
                    value={option.value}
                    checked={origin === option.value}
                    onChange={() => setOrigin(option.value)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {origin === "INGESTED" ? (
              <p className="mt-2 text-xs text-amber-800">
                External articles always need a review before they can be added to a newsletter.
              </p>
            ) : null}
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Source name" hint="For example: Trimble" error={errorFor("sourceName")}>
              <input
                type="text"
                name="sourceName"
                defaultValue={values.sourceName ?? ""}
                maxLength={120}
                className={inputClass}
              />
            </Field>

            <Field label="Author" error={errorFor("author")}>
              <input
                type="text"
                name="author"
                defaultValue={values.author ?? ""}
                maxLength={120}
                className={inputClass}
              />
            </Field>

            <Field
              label="Link to the full article"
              hint="Adds a “Read more” button to the newsletter."
              error={errorFor("externalUrl")}
            >
              <input
                type="url"
                name="externalUrl"
                defaultValue={values.externalUrl ?? ""}
                placeholder="https://example.com/article"
                dir="ltr"
                className={inputClass}
              />
            </Field>

            <Field label="Published on" error={errorFor("publishedAt")}>
              <input
                type="date"
                name="publishedAt"
                defaultValue={asDateInput(values.publishedAt)}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link href="/content" className={buttonSecondary}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
