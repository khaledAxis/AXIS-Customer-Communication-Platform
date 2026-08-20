import "server-only";

import { Role } from "../../domain/auth/authorization";
import { UserInputError, parseNewUser } from "../../domain/auth/credentials";
import { getPrisma } from "../db/prisma";
import { hashPassword } from "../auth/password";
import { retireDevelopmentStandIn } from "./userService";

/**
 * First-administrator bootstrap (ADR-0023).
 *
 * The chicken-and-egg problem: user administration requires an administrator, and
 * this platform must not invent one. The answer is a one-time, self-closing door.
 *
 * The gate is `hasRealAdministrator()`, and it is evaluated on the SERVER, inside the
 * same transaction that creates the account:
 *
 *  - it counts only accounts that could actually be used — ACTIVE, role ADMIN, and
 *    not a system account — so the retired development stand-in can never make the
 *    system look bootstrapped;
 *  - the check is repeated inside the transaction, so two people opening the setup
 *    page at the same moment cannot both create a first administrator;
 *  - once one exists the page and the action both refuse, permanently. There is no
 *    flag to unset and no environment variable that re-opens it.
 *
 * Deliberately absent: any way to create an account without a password, any default
 * password, and any credential written to a file. The owner types their own password
 * once, into their own browser, and it is hashed before it touches the database.
 */

/**
 * True when at least one usable human administrator exists.
 *
 * "Usable" is the whole point: `isSystemAccount: false` excludes the development
 * stand-in, and `isActive: true` means a deactivated administrator does not lock the
 * platform out of ever bootstrapping again.
 */
export async function hasRealAdministrator(): Promise<boolean> {
  const count = await getPrisma().user.count({
    where: { role: Role.ADMIN, isActive: true, isSystemAccount: false },
  });
  return count > 0;
}

export class BootstrapClosedError extends Error {
  constructor() {
    super(
      "An administrator account already exists. Sign in instead — new accounts are created from Admin → Users.",
    );
    this.name = "BootstrapClosedError";
  }
}

export interface BootstrapResult {
  id: string;
  email: string;
}

/**
 * Creates the very first administrator.
 *
 * Also retires the development stand-in in the same transaction: from this moment the
 * platform has a real identity to attribute work to, and the stand-in must stop being
 * usable. Its historical rows are untouched.
 */
export async function bootstrapFirstAdministrator(input: {
  name: unknown;
  email: unknown;
  password: unknown;
  confirmPassword: unknown;
}): Promise<BootstrapResult> {
  if (await hasRealAdministrator()) throw new BootstrapClosedError();

  const parsed = parseNewUser({
    name: input.name,
    email: input.email,
    role: Role.ADMIN,
    password: input.password,
    confirmPassword: input.confirmPassword,
  });

  const prisma = getPrisma();
  const existing = await prisma.user.count({ where: { email: parsed.email } });
  if (existing > 0) {
    throw new UserInputError([
      { field: "email", message: "An account with that email already exists." },
    ]);
  }

  const passwordHash = await hashPassword(parsed.password);

  const created = await prisma.$transaction(async (tx) => {
    // Re-checked inside the transaction: two simultaneous submissions must not both
    // succeed, and the count outside the transaction is only an early exit.
    const admins = await tx.user.count({
      where: { role: Role.ADMIN, isActive: true, isSystemAccount: false },
    });
    if (admins > 0) throw new BootstrapClosedError();

    const user = await tx.user.create({
      data: {
        name: parsed.name,
        email: parsed.email,
        role: Role.ADMIN,
        passwordHash,
        isActive: true,
        // The owner chose this password themselves, so there is nothing to replace.
        mustChangePassword: false,
      },
      select: { id: true, email: true },
    });

    await tx.auditLog.create({
      data: {
        action: "ADMIN_BOOTSTRAPPED",
        actorUserId: user.id,
        entityType: "User",
        entityId: user.id,
        toState: "ADMIN",
        // Identity only — never the password or its hash.
        metadata: { email: user.email, firstAdministrator: true },
      },
    });

    return user;
  });

  // Outside the transaction: retiring the stand-in is bookkeeping, and its failure
  // must not undo a successfully created administrator.
  await retireDevelopmentStandIn();

  return created;
}
