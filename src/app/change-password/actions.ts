"use server";

import { redirect } from "next/navigation";

import { UserInputError } from "../../domain/auth/credentials";
import { requireSignedIn } from "../../server/auth/session";
import { changeOwnPassword } from "../../server/services/userService";

/**
 * Replacing an administrator-issued password (ADR-0024).
 *
 * `requireSignedIn` rather than `requireCapability`: the whole point is that this
 * person currently holds NO capability, so demanding one would lock them out of the
 * only screen that can unlock them.
 *
 * The account is still identified by the session — there is no user id in the form.
 */

export interface ChangePasswordFormState {
  ok: boolean;
  message: string;
  issues: string[];
}

export async function changePasswordAction(
  _state: ChangePasswordFormState,
  formData: FormData,
): Promise<ChangePasswordFormState> {
  const actor = await requireSignedIn("/change-password");

  try {
    await changeOwnPassword(actor, {
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });
  } catch (error) {
    if (error instanceof UserInputError) {
      return {
        ok: false,
        message: "Please fix the following:",
        issues: error.issues.map((issue) => issue.message),
      };
    }
    throw error;
  }

  // The session cookie still names the same person; what changed is the row it points
  // at, and the DAL re-reads that on the next request. Nothing to refresh by hand.
  redirect("/?password-changed=1");
}
