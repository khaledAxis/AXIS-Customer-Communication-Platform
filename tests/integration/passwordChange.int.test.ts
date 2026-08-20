import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

import {
  Capability,
  PasswordChangeRequiredError,
  Role,
} from "../../src/domain/auth/authorization";
import { UserInputError } from "../../src/domain/auth/credentials";
import { resetSignInThrottle } from "../../src/server/auth/rateLimit";
import { getCurrentActor, requireCapability } from "../../src/server/auth/session";
import { verifyCredentials } from "../../src/server/auth/verifyCredentials";
import { getPrisma } from "../../src/server/db/prisma";
import { setConsent } from "../../src/server/services/communicationService";
import {
  changeOwnPassword,
  createStaffAccount,
} from "../../src/server/services/userService";
import {
  actAs,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * Forced replacement of an administrator-issued password (ADR-0024 §29).
 *
 * The limitation reported at the end of the previous milestone: `mustChangePassword`
 * was recorded and not enforced, so a password two people knew stayed usable
 * indefinitely. It is now a hard gate.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const INITIAL = "Axis-Initial-2026";
const CHOSEN = "Chosen-By-Owner-2026";

const ids = { users: [] as string[], addresses: [] as string[] };

d("forced password change", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let admin: TestUser;
  let newcomerId = "";
  let newcomerEmail = "";

  beforeAll(async () => {
    prisma = getPrisma();
    admin = await createTestUser({ prefix: `${RUN}-admin`, role: Role.ADMIN });
    ids.users.push(admin.id);
  });

  beforeEach(async () => {
    resetSignInThrottle();
    actAs(admin);

    // A fresh colleague for each test, so one test's password change cannot mask
    // another's expectations.
    const created = await createStaffAccount({
      name: `${RUN} Newcomer`,
      email: `${RUN}-${randomUUID().slice(0, 8)}@axis-test.invalid`,
      role: Role.MANAGER,
      password: INITIAL,
      confirmPassword: INITIAL,
    });
    newcomerId = created.id;
    newcomerEmail = created.email;
    ids.users.push(created.id);
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    clearTestActor();
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids.users } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids.users } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids.addresses } } });
    await prisma.communicationAddress.deleteMany({
      where: { id: { in: ids.addresses } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  });

  /** The colleague, as their own session would present them. */
  async function asNewcomer(): Promise<TestUser> {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: newcomerId } });
    const actor: TestUser = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role as Role,
      isActive: row.isActive,
      isSystemAccount: row.isSystemAccount,
      mustChangePassword: row.mustChangePassword,
    };
    actAs(actor);
    return actor;
  }

  // ---- 41..42 the gate ----------------------------------------------------

  it("flags an administrator-issued password for replacement", async () => {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: newcomerId } });
    expect(row.mustChangePassword).toBe(true);
  });

  it("blocks every capability until the password is replaced", async () => {
    await asNewcomer();

    // Not "not allowed" — a distinct, actionable state.
    await expect(requireCapability(Capability.VIEW_CRM)).rejects.toThrowError(
      PasswordChangeRequiredError,
    );
    await expect(
      requireCapability(Capability.MANAGE_NEWSLETTERS),
    ).rejects.toThrowError(PasswordChangeRequiredError);
    await expect(requireCapability(Capability.RECORD_CONSENT)).rejects.toThrowError(
      PasswordChangeRequiredError,
    );
  });

  it("cannot change customer data while the flag is set", async () => {
    const address = await prisma.communicationAddress.create({
      data: { normalizedEmail: `${RUN}-${randomUUID().slice(0, 6)}@example.test` },
    });
    ids.addresses.push(address.id);

    await asNewcomer();
    await expect(
      setConsent({
        status: "DENIED",
        addressIds: [address.id],
        confirmed: "on",
      }),
    ).rejects.toThrowError(PasswordChangeRequiredError);

    const unchanged = await prisma.communicationAddress.findUniqueOrThrow({
      where: { id: address.id },
    });
    expect(unchanged.consentStatus).toBe("UNKNOWN");
  });

  it("still lets them sign in — the gate is inside the app, not at the door", async () => {
    // They must be able to authenticate; otherwise they could never reach the screen
    // that unlocks them.
    const result = await verifyCredentials({
      email: newcomerEmail,
      password: INITIAL,
    });
    expect(result.ok).toBe(true);
  });

  // ---- 43..47 changing it -------------------------------------------------

  it("accepts a valid replacement and clears the flag", async () => {
    const actor = await asNewcomer();
    await changeOwnPassword(actor, {
      password: CHOSEN,
      confirmPassword: CHOSEN,
    });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: newcomerId } });
    expect(row.mustChangePassword).toBe(false);
  });

  it("refuses a weak replacement", async () => {
    const actor = await asNewcomer();
    await expect(
      changeOwnPassword(actor, { password: "password", confirmPassword: "password" }),
    ).rejects.toThrowError(UserInputError);

    // Still flagged, and still the old hash.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: newcomerId } });
    expect(row.mustChangePassword).toBe(true);
    expect(await verifyCredentials({ email: newcomerEmail, password: INITIAL })).toMatchObject(
      { ok: true },
    );
  });

  it("refuses a mismatched confirmation", async () => {
    const actor = await asNewcomer();
    await expect(
      changeOwnPassword(actor, {
        password: CHOSEN,
        confirmPassword: `${CHOSEN}x`,
      }),
    ).rejects.toThrowError(UserInputError);
  });

  it("refuses a replacement that is just the account's own address", async () => {
    const actor = await asNewcomer();
    const local = newcomerEmail.split("@")[0];
    await expect(
      changeOwnPassword(actor, { password: local, confirmPassword: local }),
    ).rejects.toThrowError(UserInputError);
  });

  it("stops the old password working and starts the new one", async () => {
    const actor = await asNewcomer();
    await changeOwnPassword(actor, { password: CHOSEN, confirmPassword: CHOSEN });

    resetSignInThrottle();
    expect(
      await verifyCredentials({ email: newcomerEmail, password: INITIAL }),
    ).toEqual({ ok: false, cause: "BAD_PASSWORD" });

    resetSignInThrottle();
    expect(
      await verifyCredentials({ email: newcomerEmail, password: CHOSEN }),
    ).toMatchObject({ ok: true });
  });

  it("restores full access once the password is their own", async () => {
    const actor = await asNewcomer();
    await changeOwnPassword(actor, { password: CHOSEN, confirmPassword: CHOSEN });

    // Their session now re-reads a row with the flag cleared.
    await asNewcomer();
    const current = await getCurrentActor();
    expect(current?.mustChangePassword).toBe(false);
    await expect(requireCapability(Capability.VIEW_CRM)).resolves.toMatchObject({
      id: newcomerId,
    });
  });

  // ---- 48..49 audit and secrecy ------------------------------------------

  it("records the change without recording the password", async () => {
    const actor = await asNewcomer();
    await changeOwnPassword(actor, { password: CHOSEN, confirmPassword: CHOSEN });

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "USER_PASSWORD_CHANGED",
        entityId: newcomerId,
        toState: "CHANGED_BY_OWNER",
      },
      orderBy: [{ occurredAt: "desc" }],
    });
    expect(entry.actorUserId).toBe(newcomerId);
    expect((entry.metadata as { byAdministrator?: boolean }).byAdministrator).toBe(false);

    const blob = JSON.stringify(entry);
    expect(blob).not.toContain(CHOSEN);
    expect(blob).not.toContain(INITIAL);
    expect(blob).not.toContain("$argon2");
  });

  it("never exposes the password hash to a caller", async () => {
    const actor = await asNewcomer();
    await changeOwnPassword(actor, { password: CHOSEN, confirmPassword: CHOSEN });

    await asNewcomer();
    const current = await getCurrentActor();
    expect(Object.keys(current ?? {})).not.toContain("passwordHash");
    expect(JSON.stringify(current)).not.toContain("$argon2");
  });

  it("stores a fresh Argon2id hash, not the old one", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: newcomerId } });
    const actor = await asNewcomer();
    await changeOwnPassword(actor, { password: CHOSEN, confirmPassword: CHOSEN });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: newcomerId } });
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(after.passwordHash).not.toContain(CHOSEN);
  });
});
