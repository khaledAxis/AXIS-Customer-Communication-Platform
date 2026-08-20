"use server";

import { revalidatePath } from "next/cache";

import { NotAuthorizedError } from "../../../domain/auth/authorization";
import { UserInputError } from "../../../domain/auth/credentials";
import {
  UserAdminError,
  createStaffAccount,
  resetStaffPassword,
  setStaffActive,
  setStaffRole,
} from "../../../server/services/userService";

/**
 * Staff administration actions.
 *
 * Thin by design: each one reads the form, calls a service, maps the outcome. The
 * service starts by demanding the MANAGE_USERS capability from the SESSION, so these
 * actions are safe even though anyone can POST to a server action — a manager who
 * crafts a request gets a refusal, not a new administrator.
 *
 * Note what no action here accepts: an actor id. The person doing the work is always
 * the signed-in session, never a form field.
 */

export interface UserAdminFormState {
  ok: boolean;
  message: string;
  issues: string[];
}

const EMPTY: UserAdminFormState = { ok: false, message: "", issues: [] };

function fail(error: unknown): UserAdminFormState {
  if (error instanceof UserInputError) {
    return {
      ok: false,
      message: "Please fix the following:",
      issues: error.issues.map((issue) => issue.message),
    };
  }
  if (error instanceof UserAdminError) {
    return { ok: false, message: error.message, issues: [] };
  }
  if (error instanceof NotAuthorizedError) {
    return { ok: false, message: error.message, issues: [] };
  }
  throw error;
}

function refresh(): void {
  revalidatePath("/admin/users");
}

export async function createUserAction(
  _state: UserAdminFormState,
  formData: FormData,
): Promise<UserAdminFormState> {
  try {
    const created = await createStaffAccount({
      name: formData.get("name"),
      email: formData.get("email"),
      role: formData.get("role"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });
    refresh();
    return {
      ...EMPTY,
      ok: true,
      // The address, never the password: this message is rendered and could be
      // screenshotted or copied into a ticket.
      message: `Created ${created.email}. Give them the password in person or through a password manager — it is not shown again and cannot be recovered.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function setRoleAction(formData: FormData): Promise<void> {
  const id = formData.get("userId");
  const role = formData.get("role");
  if (typeof id !== "string") return;
  try {
    await setStaffRole(id, role);
  } catch (error) {
    if (!(error instanceof UserAdminError) && !(error instanceof NotAuthorizedError)) {
      throw error;
    }
  }
  refresh();
}

export async function setActiveAction(formData: FormData): Promise<void> {
  const id = formData.get("userId");
  const active = formData.get("isActive");
  if (typeof id !== "string") return;
  try {
    await setStaffActive(id, active === "true");
  } catch (error) {
    if (!(error instanceof UserAdminError) && !(error instanceof NotAuthorizedError)) {
      throw error;
    }
  }
  refresh();
}

export async function resetPasswordAction(
  _state: UserAdminFormState,
  formData: FormData,
): Promise<UserAdminFormState> {
  const id = formData.get("userId");
  if (typeof id !== "string") return { ...EMPTY, message: "That account no longer exists." };

  try {
    await resetStaffPassword(id, {
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });
    refresh();
    return {
      ...EMPTY,
      ok: true,
      message:
        "Password set. The person is asked to choose their own the next time they sign in.",
    };
  } catch (error) {
    return fail(error);
  }
}
