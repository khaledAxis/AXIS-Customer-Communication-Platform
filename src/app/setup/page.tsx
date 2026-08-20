import { redirect } from "next/navigation";

import { hasRealAdministrator } from "../../server/services/bootstrapService";
import { BootstrapForm } from "../../ui/AuthForms";
import { bootstrapAction } from "./actions";

/**
 * One-time first-administrator setup.
 *
 * The page checks the same condition the service enforces, so it disappears as soon
 * as a real administrator exists. The check here is convenience; the authoritative
 * one runs inside the creating transaction, which is what makes two people opening
 * this page at once safe.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Set up AXIS Communication" };

export default async function SetupPage() {
  if (await hasRealAdministrator()) redirect("/login");

  return (
    <div className="flex min-h-[70vh] items-center py-10">
      <BootstrapForm action={bootstrapAction} />
    </div>
  );
}
