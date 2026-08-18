"use client";

import { useActionState, useState } from "react";

import type { NewsletterFormState } from "../app/newsletters/actions";
import { Card, ErrorSummary, Field, buttonPrimary, inputClass } from "./primitives";

type Action = (state: NewsletterFormState, formData: FormData) => Promise<NewsletterFormState>;

export function NewsletterDetailsForm({
  action,
  submitLabel,
  values = {},
  compact = false,
}: {
  action: Action;
  submitLabel: string;
  values?: {
    id?: string;
    name?: string | null;
    subject?: string | null;
    preheader?: string | null;
    language?: string | null;
  };
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, errors: [] });
  const [language, setLanguage] = useState(values.language ?? "HE");

  const errorFor = (field: string) => state.errors.find((e) => e.field === field)?.message;
  const rtl = language === "HE" || language === "AR";

  const body = (
    <div className="space-y-5">
      <ErrorSummary errors={state.errors} />

      {state.ok ? (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-semibold text-emerald-800">Saved.</p>
        </div>
      ) : null}

      <Field
        label="Newsletter name"
        hint="Only you and your colleagues see this — it is not part of the email."
        required
        error={errorFor("name")}
      >
        <input
          type="text"
          name="name"
          defaultValue={values.name ?? ""}
          required
          maxLength={150}
          placeholder="For example: September customer update"
          className={inputClass}
        />
      </Field>

      <Field
        label="Email subject line"
        hint="This is what customers see in their inbox."
        required
        error={errorFor("subject")}
      >
        <input
          type="text"
          name="subject"
          defaultValue={values.subject ?? ""}
          required
          maxLength={200}
          dir={rtl ? "rtl" : "ltr"}
          className={inputClass}
        />
      </Field>

      <Field
        label="Preview text"
        hint="The short line shown after the subject in most email apps."
        error={errorFor("preheader")}
      >
        <input
          type="text"
          name="preheader"
          defaultValue={values.preheader ?? ""}
          maxLength={150}
          dir={rtl ? "rtl" : "ltr"}
          className={inputClass}
        />
      </Field>

      <Field label="Language" required error={errorFor("language")}>
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

      <div>
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  );

  return (
    <form action={formAction}>
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      {compact ? body : <Card className="p-6">{body}</Card>}
    </form>
  );
}
