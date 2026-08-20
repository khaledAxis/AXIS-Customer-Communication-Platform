"use server";

import { redirect } from "next/navigation";

import { UserInputError } from "../../domain/auth/credentials";
import {
  BootstrapClosedError,
  bootstrapFirstAdministrator,
} from "../../server/services/bootstrapService";

/**
 * Creating the first administrator.
 *
 * The gate lives in the service and is re-evaluated inside the creating transaction,
 * so this action cannot be the thing that decides whether setup is still open — it
 * only reports what the service decided.
 */

export interface SetupFormState {
  ok: boolean;
  message: string;
  issues: string[];
}

export async function bootstrapAction(
  _state: SetupFormState,
  formData: FormData,
): Promise<SetupFormState> {
  try {
    await bootstrapFirstAdministrator({
      name: formData.get("name"),
      email: formData.get("email"),
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
    if (error instanceof BootstrapClosedError) {
      return { ok: false, message: error.message, issues: [] };
    }
    throw error;
  }

  // Deliberately NOT signed in automatically: the owner proves the password works by
  // typing it once more, and any mistake surfaces now rather than at the next login.
  redirect("/login?created=1");
}
