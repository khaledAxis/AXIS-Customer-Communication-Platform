"use client";

import { useActionState, useState } from "react";

import type { ChangePasswordFormState } from "../app/change-password/actions";
import type { LoginFormState } from "../app/login/actions";
import type { SetupFormState } from "../app/setup/actions";
import { MIN_PASSWORD_LENGTH, passwordStrength } from "../domain/auth/passwordPolicy";
import { buttonPrimary, inputClass } from "./primitives";

/**
 * The two anonymous screens: signing in, and creating the very first administrator.
 *
 * Both are client components only because they need pending state and a live password
 * hint. No decision is made here — the strength meter is advisory, the real policy
 * runs on the server, and a password never leaves the form except in the submission.
 */

function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-8 flex items-center gap-3">
        <span
          aria-hidden
          className="grid h-11 w-11 place-items-center rounded-xl bg-slate-900 text-base font-black text-white"
        >
          AX
        </span>
        <div>
          <p className="text-lg font-bold tracking-tight text-slate-900">
            AXIS Communication
          </p>
          <p className="text-xs text-slate-500">
            AXIS GPS &amp; Mapping Solutions — internal tool
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function Problem({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800"
    >
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export function LoginForm({
  action,
  next,
  notice,
}: {
  action: (state: LoginFormState, formData: FormData) => Promise<LoginFormState>;
  next: string;
  notice: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
  });

  return (
    <AuthCard title="Sign in" subtitle="Use your AXIS staff account.">
      {notice ? (
        <div
          role="status"
          className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {notice}
        </div>
      ) : null}
      <Problem message={state.message} />

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />

        <label className="block">
          <span className="text-sm font-semibold text-slate-800">Email address</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            dir="ltr"
            className={`${inputClass} mt-1.5`}
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-800">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            className={`${inputClass} mt-1.5`}
          />
        </label>

        <button type="submit" className={`${buttonPrimary} w-full`} disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">
        Accounts are created by an AXIS administrator. There is no sign-up — if you need
        access, ask an administrator to add you.
      </p>
    </AuthCard>
  );
}

// ---------------------------------------------------------------------------
// First administrator
// ---------------------------------------------------------------------------

function StrengthHint({ password }: { password: string }) {
  if (password === "") return null;
  const strength = passwordStrength(password);
  const tone =
    strength === "strong"
      ? "text-emerald-700"
      : strength === "fair"
        ? "text-amber-700"
        : "text-rose-700";
  const label =
    strength === "strong" ? "Strong" : strength === "fair" ? "Acceptable" : "Too weak";
  return (
    <p className={`mt-1 text-xs font-semibold ${tone}`}>
      {label} — at least {MIN_PASSWORD_LENGTH} characters, with upper and lower case and
      a number.
    </p>
  );
}

export function BootstrapForm({
  action,
}: {
  action: (state: SetupFormState, formData: FormData) => Promise<SetupFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
    issues: [],
  });
  const [password, setPassword] = useState("");

  return (
    <AuthCard
      title="Create the first administrator"
      subtitle="This screen appears only because no AXIS administrator account exists yet. It closes permanently once one does."
    >
      <Problem message={state.message} />
      {state.issues.length > 0 ? (
        <ul
          role="alert"
          className="mb-4 list-disc space-y-1 rounded-lg border border-rose-200 bg-rose-50 p-3 ps-8 text-sm text-rose-800"
        >
          {state.issues.map((issue, index) => (
            <li key={`${issue}-${index}`}>{issue}</li>
          ))}
        </ul>
      ) : null}

      <form action={formAction} className="space-y-4">
        <label className="block">
          <span className="text-sm font-semibold text-slate-800">Your name</span>
          <input type="text" name="name" required className={`${inputClass} mt-1.5`} />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-800">Email address</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            dir="ltr"
            className={`${inputClass} mt-1.5`}
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-800">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={`${inputClass} mt-1.5`}
          />
          <StrengthHint password={password} />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-800">Confirm password</span>
          <input
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            className={`${inputClass} mt-1.5`}
          />
        </label>

        <button type="submit" className={`${buttonPrimary} w-full`} disabled={pending}>
          {pending ? "Creating…" : "Create administrator account"}
        </button>
      </form>

      <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">
        Your password is hashed with Argon2id before it is stored. AXIS never keeps the
        password itself, and nobody — including an administrator — can read it back.
      </p>
    </AuthCard>
  );
}

// ---------------------------------------------------------------------------
// Replacing an administrator-issued password
// ---------------------------------------------------------------------------

export function ChangePasswordForm({
  action,
  email,
}: {
  action: (
    state: ChangePasswordFormState,
    formData: FormData,
  ) => Promise<ChangePasswordFormState>;
  email: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    ok: false,
    message: "",
    issues: [],
  });
  const [password, setPassword] = useState("");

  return (
    <AuthCard
      title="Choose your own password"
      subtitle="An administrator set the password you signed in with. Two people know it, so it cannot be used for anything else until you replace it."
    >
      <Problem message={state.message} />
      {state.issues.length > 0 ? (
        <ul
          role="alert"
          className="mb-4 list-disc space-y-1 rounded-lg border border-rose-200 bg-rose-50 p-3 ps-8 text-sm text-rose-800"
        >
          {state.issues.map((issue, index) => (
            <li key={`${issue}-${index}`}>{issue}</li>
          ))}
        </ul>
      ) : null}

      <form action={formAction} className="space-y-4">
        {/* Present only so a password manager files the entry correctly. The account
            is identified by the session; this field is never read by the server. */}
        <input type="hidden" name="username" autoComplete="username" value={email} readOnly />

        <label className="block">
          <span className="text-sm font-semibold text-slate-800">New password</span>
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={`${inputClass} mt-1.5`}
          />
          <StrengthHint password={password} />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-800">Confirm password</span>
          <input
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            className={`${inputClass} mt-1.5`}
          />
        </label>

        <button type="submit" className={`${buttonPrimary} w-full`} disabled={pending}>
          {pending ? "Saving…" : "Save and continue"}
        </button>
      </form>

      <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">
        Until you do this, your account cannot approve newsletters, record consent, or
        change customer settings.
      </p>
    </AuthCard>
  );
}
