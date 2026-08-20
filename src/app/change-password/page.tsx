import { redirect } from "next/navigation";

import { requireSignedIn } from "../../server/auth/session";
import { ChangePasswordForm } from "../../ui/AuthForms";
import { changePasswordAction } from "./actions";

/**
 * Forced password change.
 *
 * Reached by anyone whose account still carries an administrator-issued password:
 * `requirePage` sends every other route here, and this page uses `requireSignedIn` so
 * it stays reachable for exactly those people.
 *
 * Someone who has already chosen their own password has no business here and is sent
 * back to the dashboard.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Choose a password — AXIS" };

export default async function ChangePasswordPage() {
  const actor = await requireSignedIn("/change-password");
  if (!actor.mustChangePassword) redirect("/");

  return (
    <div className="flex min-h-[70vh] items-center py-10">
      <ChangePasswordForm action={changePasswordAction} email={actor.email} />
    </div>
  );
}
