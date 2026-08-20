import { Capability, requirePageCapability } from "../../../server/auth/session";
import { listStaffAccounts } from "../../../server/services/userService";
import { PageHeader } from "../../../ui/primitives";
import { UserAdminPanel } from "../../../ui/UserAdminPanel";
import {
  createUserAction,
  resetPasswordAction,
  setActiveAction,
  setRoleAction,
} from "./actions";

/**
 * Staff administration — administrators only.
 *
 * `requirePageCapability` redirects anyone else away, and `listStaffAccounts` demands
 * the same capability again before it reads a row. The page guard is for the person;
 * the service guard is the one that matters.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Staff accounts — AXIS" };

export default async function UsersPage() {
  const actor = await requirePageCapability(Capability.MANAGE_USERS, "/admin/users");
  const accounts = await listStaffAccounts();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff accounts"
        description="Who can sign in to this platform, and what they are allowed to do. Accounts are deactivated rather than deleted, so historical approvals keep naming a real person."
      />

      <UserAdminPanel
        accounts={accounts}
        viewerId={actor.id}
        createAction={createUserAction}
        resetAction={resetPasswordAction}
        setRoleAction={setRoleAction}
        setActiveAction={setActiveAction}
      />
    </div>
  );
}
