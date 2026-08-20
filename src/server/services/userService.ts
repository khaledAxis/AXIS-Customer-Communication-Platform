import "server-only";

import { Prisma } from "@prisma/client";

import {
  Capability,
  Role,
  type Actor,
} from "../../domain/auth/authorization";
import {
  UserInputError,
  parseNewUser,
  parsePasswordChange,
} from "../../domain/auth/credentials";
import { getPrisma } from "../db/prisma";
import { hashPassword, UNUSABLE_PASSWORD_HASH } from "../auth/password";
import { requireCapability } from "../auth/session";

/**
 * Staff account administration (ADR-0023).
 *
 * Every mutating function starts with `requireCapability(MANAGE_USERS)`, which reads
 * the actor from the session and the role from the database. There is no parameter
 * on any of these functions through which a caller could name themselves, so a
 * forged form field has nothing to attach to.
 *
 * What never leaves this module: `passwordHash`. No returned type contains it, and
 * the read queries do not select it.
 */

/** The shape the admin UI sees. Note the absence of `passwordHash`. */
export interface StaffAccount {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  isActive: boolean;
  isSystemAccount: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  /** Historical references that make a hard delete unsafe. */
  historyCount: number;
}

export class UserAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserAdminError";
  }
}

const SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  isSystemAccount: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export async function listStaffAccounts(): Promise<StaffAccount[]> {
  await requireCapability(Capability.MANAGE_USERS);
  const prisma = getPrisma();

  const rows = await prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { email: "asc" }],
    select: {
      ...SAFE_SELECT,
      _count: {
        select: {
          createdCampaigns: true,
          approvedCampaigns: true,
          productionApprovals: true,
          testSendApprovals: true,
          preparedAudiences: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as Role,
    isActive: row.isActive,
    isSystemAccount: row.isSystemAccount,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    historyCount:
      row._count.createdCampaigns +
      row._count.approvedCampaigns +
      row._count.productionApprovals +
      row._count.testSendApprovals +
      row._count.preparedAudiences,
  }));
}

/**
 * Creates a staff account.
 *
 * The password is hashed before the row is written and the plaintext is dropped when
 * this function returns — it is never stored, echoed, or included in the audit entry.
 */
export async function createStaffAccount(input: {
  name: unknown;
  email: unknown;
  role: unknown;
  password: unknown;
  confirmPassword?: unknown;
  mustChangePassword?: unknown;
}): Promise<{ id: string; email: string }> {
  const actor = await requireCapability(Capability.MANAGE_USERS);
  const parsed = parseNewUser(input);

  const prisma = getPrisma();
  const existing = await prisma.user.count({ where: { email: parsed.email } });
  if (existing > 0) {
    throw new UserInputError([
      { field: "email", message: "An account with that email already exists." },
    ]);
  }

  const passwordHash = await hashPassword(parsed.password);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: parsed.name,
        email: parsed.email,
        role: parsed.role,
        passwordHash,
        isActive: true,
        // An administrator-chosen password is a shared secret until the owner
        // replaces it. See ADR-0023 for the v1 limitation on enforcing this.
        mustChangePassword: input.mustChangePassword === undefined ? true : Boolean(input.mustChangePassword),
      },
      select: { id: true, email: true },
    });

    await tx.auditLog.create({
      data: {
        action: "USER_CREATED",
        actorUserId: actor.id,
        entityType: "User",
        entityId: user.id,
        toState: parsed.role,
        // Identity and role only. No password, no hash.
        metadata: { email: user.email, role: parsed.role },
      },
    });

    return user;
  });

  return created;
}

export async function setStaffRole(
  userId: string,
  role: unknown,
): Promise<void> {
  const actor = await requireCapability(Capability.MANAGE_USERS);
  if (role !== Role.ADMIN && role !== Role.MANAGER) {
    throw new UserAdminError("Choose Administrator or Manager.");
  }

  const prisma = getPrisma();
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, isSystemAccount: true, isActive: true },
  });
  if (!target) throw new UserAdminError("That account no longer exists.");
  if (target.isSystemAccount) {
    throw new UserAdminError("That is a system record, not a staff account.");
  }
  if (target.role === role) return;

  // Removing the last administrator would lock everyone out of user management.
  if (target.role === Role.ADMIN && role === Role.MANAGER) {
    await assertNotLastAdministrator(target.id);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { role } });
    await tx.auditLog.create({
      data: {
        action: "USER_ROLE_CHANGED",
        actorUserId: actor.id,
        entityType: "User",
        entityId: userId,
        fromState: target.role,
        toState: role,
        metadata: { email: target.email },
      },
    });
  });
}

/**
 * Activates or deactivates an account.
 *
 * Deactivation is the deliberate alternative to deletion: the row stays, so every
 * historical approval and audit entry keeps naming a real person, but the account can
 * no longer sign in. Sessions are invalidated implicitly — the session DAL re-reads
 * `isActive` on every request, so an open tab loses access on its next action.
 */
export async function setStaffActive(
  userId: string,
  isActive: boolean,
): Promise<void> {
  const actor = await requireCapability(Capability.MANAGE_USERS);
  const prisma = getPrisma();

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, isActive: true, isSystemAccount: true },
  });
  if (!target) throw new UserAdminError("That account no longer exists.");
  if (target.isSystemAccount) {
    throw new UserAdminError("That is a system record, not a staff account.");
  }
  if (target.isActive === isActive) return;

  if (!isActive) {
    if (target.id === actor.id) {
      throw new UserAdminError("You cannot deactivate your own account.");
    }
    if (target.role === Role.ADMIN) await assertNotLastAdministrator(target.id);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { isActive, deactivatedAt: isActive ? null : new Date() },
    });
    await tx.auditLog.create({
      data: {
        action: isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
        actorUserId: actor.id,
        entityType: "User",
        entityId: userId,
        fromState: target.isActive ? "ACTIVE" : "INACTIVE",
        toState: isActive ? "ACTIVE" : "INACTIVE",
        metadata: { email: target.email },
      },
    });
  });
}

/** An administrator issuing a new password for someone who is locked out. */
export async function resetStaffPassword(
  userId: string,
  input: { password: unknown; confirmPassword: unknown },
): Promise<void> {
  const actor = await requireCapability(Capability.MANAGE_USERS);
  const prisma = getPrisma();

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, isSystemAccount: true },
  });
  if (!target) throw new UserAdminError("That account no longer exists.");
  if (target.isSystemAccount) {
    throw new UserAdminError("That is a system record, not a staff account.");
  }

  const parsed = parsePasswordChange({ ...input, email: target.email });
  const passwordHash = await hashPassword(parsed.password);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true },
    });
    await tx.auditLog.create({
      data: {
        action: "USER_PASSWORD_CHANGED",
        actorUserId: actor.id,
        entityType: "User",
        entityId: userId,
        toState: "RESET_BY_ADMIN",
        // Records THAT it changed, never what it changed to.
        metadata: { email: target.email, byAdministrator: true },
      },
    });
  });
}

/** A signed-in person replacing their own password. */
export async function changeOwnPassword(
  actor: Actor,
  input: { password: unknown; confirmPassword: unknown },
): Promise<void> {
  const parsed = parsePasswordChange({ ...input, email: actor.email });
  const passwordHash = await hashPassword(parsed.password);
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.id },
      data: { passwordHash, mustChangePassword: false },
    });
    await tx.auditLog.create({
      data: {
        action: "USER_PASSWORD_CHANGED",
        actorUserId: actor.id,
        entityType: "User",
        entityId: actor.id,
        toState: "CHANGED_BY_OWNER",
        metadata: { email: actor.email, byAdministrator: false },
      },
    });
  });
}

async function assertNotLastAdministrator(excludingId: string): Promise<void> {
  const remaining = await getPrisma().user.count({
    where: {
      role: Role.ADMIN,
      isActive: true,
      isSystemAccount: false,
      id: { not: excludingId },
    },
  });
  if (remaining === 0) {
    throw new UserAdminError(
      "This is the only active administrator. Promote someone else first.",
    );
  }
}

// ---------------------------------------------------------------------------
// The pre-authentication development stand-in
// ---------------------------------------------------------------------------

/** The account earlier milestones attributed every action to. */
export const DEV_STAND_IN_EMAIL = "dev-local@axis-gps.invalid";

/**
 * Retires the development stand-in.
 *
 * It is NOT deleted and NOT promoted: historical campaigns, approvals and audit rows
 * reference it, and rewriting them to name a real employee would fabricate a record
 * of who did what. Instead it is marked as a system account, deactivated, and its
 * password value replaced with one that can never verify — so it stays readable as
 * history and can never sign in or approve anything.
 *
 * Idempotent: safe to run on every boot.
 */
export async function retireDevelopmentStandIn(): Promise<boolean> {
  const prisma = getPrisma();
  const standIn = await prisma.user.findUnique({
    where: { email: DEV_STAND_IN_EMAIL },
    select: { id: true, isSystemAccount: true, isActive: true },
  });
  if (!standIn) return false;
  if (standIn.isSystemAccount && !standIn.isActive) return false;

  await prisma.user.update({
    where: { id: standIn.id },
    data: {
      isSystemAccount: true,
      isActive: false,
      passwordHash: UNUSABLE_PASSWORD_HASH,
      deactivatedAt: new Date(),
    },
  });
  return true;
}

/** Prisma unique-violation helper, so callers can report a friendly conflict. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}
