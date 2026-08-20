"use server";

import { AuthError } from "next-auth";
import { unstable_rethrow } from "next/navigation";

import { SignInInputError, parseSignIn } from "../../domain/auth/credentials";
import {
  SIGN_IN_FAILED_MESSAGE,
  SIGN_IN_RATE_LIMITED_MESSAGE,
  signIn,
  signOut,
} from "../../server/auth/config";

/**
 * Sign in and sign out.
 *
 * Thin: read the form, hand the credentials to Auth.js, map the outcome to a
 * message. Every decision — whether the password matches, whether the account is
 * active, whether the attempt is throttled — happens in `authorize()` on the server.
 *
 * The failure message is deliberately the SAME for an unknown address, a wrong
 * password and a deactivated account. Telling an anonymous caller which of those it
 * was is telling them which addresses exist.
 */

export interface LoginFormState {
  ok: boolean;
  message: string;
}

/**
 * Only a same-origin path is accepted as a post-login destination. A value like
 * `//evil.example` or `https://evil.example` would otherwise turn the login form into
 * an open redirect.
 */
function safeReturnTo(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function signInAction(
  _state: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const redirectTo = safeReturnTo(formData.get("next"));

  try {
    // Parsed here purely to give a friendly "fill both fields" message; the same
    // parse runs again inside `authorize()`, which is the one that matters.
    parseSignIn({ email: formData.get("email"), password: formData.get("password") });
  } catch (error) {
    if (error instanceof SignInInputError) return { ok: false, message: error.message };
    throw error;
  }

  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo,
    });
  } catch (error) {
    // A successful sign-in throws a framework redirect. `unstable_rethrow` lets it
    // continue — swallowing it would leave the user staring at the login form.
    unstable_rethrow(error);

    if (error instanceof AuthError) {
      // Auth.js surfaces a CredentialsSignin subclass by its `code`. Only the
      // throttle is distinguished; every other cause is one generic sentence.
      const code = (error as { code?: unknown }).code;
      if (code === "rate_limited") {
        return { ok: false, message: SIGN_IN_RATE_LIMITED_MESSAGE };
      }
      return { ok: false, message: SIGN_IN_FAILED_MESSAGE };
    }
    throw error;
  }

  // Unreachable in practice: `signIn` with `redirectTo` always redirects.
  return { ok: true, message: "" };
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
