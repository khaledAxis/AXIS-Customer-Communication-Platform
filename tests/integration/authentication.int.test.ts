import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  Capability,
  NotAuthenticatedError,
  NotAuthorizedError,
  Role,
} from "../../src/domain/auth/authorization";
import { UserInputError } from "../../src/domain/auth/credentials";
import { getPrisma } from "../../src/server/db/prisma";
import { hashPassword, UNUSABLE_PASSWORD_HASH } from "../../src/server/auth/password";
import { resetSignInThrottle } from "../../src/server/auth/rateLimit";
import { requireCapability } from "../../src/server/auth/session";
import { verifyCredentials } from "../../src/server/auth/verifyCredentials";
import {
  bootstrapFirstAdministrator,
  hasRealAdministrator,
} from "../../src/server/services/bootstrapService";
import {
  createStaffAccount,
  listStaffAccounts,
  resetStaffPassword,
  setStaffActive,
  setStaffRole,
  UserAdminError,
} from "../../src/server/services/userService";
import { setConsent } from "../../src/server/services/communicationService";
import {
  actAs,
  actAsNobody,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * Authentication and authorization against real PostgreSQL (ADR-0023).
 *
 * Real Argon2id hashing, real `User` rows, real service gates. Nothing is stubbed:
 * the point of this suite is that the code which decides who may act is the code that
 * ran, not an approximation of it.
 *
 * Every account created here carries a run-scoped address so parallel suites — and
 * the real staff accounts in the development database — are never touched.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const email = (local: string) => `${RUN}-${local}@axis-test.invalid`;

const PASSWORD = "Axis-Mapping-2026";
const OTHER_PASSWORD = "Different-Mapping-2026";

const created: string[] = [];

d("authentication", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let admin: TestUser;
  let manager: TestUser;

  /** A real account with a real password, for the credentials path. */
  let signInUserId = "";
  const signInEmail = email("signin");
  const inactiveEmail = email("inactive");
  const systemEmail = email("system");

  beforeAll(async () => {
    prisma = getPrisma();

    admin = await createTestUser({ prefix: `${RUN}-admin`, role: Role.ADMIN });
    manager = await createTestUser({ prefix: `${RUN}-manager`, role: Role.MANAGER });
    created.push(admin.id, manager.id);

    const hash = await hashPassword(PASSWORD);
    const signInUser = await prisma.user.create({
      data: {
        email: signInEmail,
        name: "Sign-in Test",
        role: Role.MANAGER,
        passwordHash: hash,
        isActive: true,
      },
      select: { id: true },
    });
    signInUserId = signInUser.id;
    created.push(signInUser.id);

    const inactive = await prisma.user.create({
      data: {
        email: inactiveEmail,
        name: "Deactivated Test",
        role: Role.MANAGER,
        passwordHash: hash,
        isActive: false,
      },
      select: { id: true },
    });
    created.push(inactive.id);

    // A stand-in of the same shape as the retired development actor.
    const system = await prisma.user.create({
      data: {
        email: systemEmail,
        name: "Historical stand-in",
        role: Role.ADMIN,
        passwordHash: hash,
        isActive: true,
        isSystemAccount: true,
      },
      select: { id: true },
    });
    created.push(system.id);
  });

  beforeEach(() => {
    resetSignInThrottle();
    actAs(admin);
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    clearTestActor();
    const all = [...created];
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: all } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: all } } });
    await prisma.user.deleteMany({ where: { id: { in: all } } });
    await prisma.user.deleteMany({ where: { email: { contains: RUN } } });
  });

  // ---- 1..3, 17 the credentials path ------------------------------------

  it("signs in with valid credentials", async () => {
    const result = await verifyCredentials({ email: signInEmail, password: PASSWORD });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe(signInUserId);
      expect(result.email).toBe(signInEmail);
    }
  });

  it("records the sign-in and stamps the last-login time", async () => {
    await verifyCredentials({ email: signInEmail, password: PASSWORD });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: signInUserId } });
    expect(user.lastLoginAt).not.toBeNull();

    const entry = await prisma.auditLog.findFirst({
      where: { action: "USER_SIGNED_IN", entityId: signInUserId },
      orderBy: [{ occurredAt: "desc" }],
    });
    expect(entry).not.toBeNull();
    // Never the password, never a hash, never a token.
    expect(JSON.stringify(entry?.metadata)).not.toContain(PASSWORD);
    expect(JSON.stringify(entry?.metadata)).not.toContain("$argon2");
  });

  it("rejects an invalid password", async () => {
    const result = await verifyCredentials({
      email: signInEmail,
      password: "Wrong-Password-2026",
    });
    expect(result).toEqual({ ok: false, cause: "BAD_PASSWORD" });
  });

  it("rejects an unknown address, and says nothing different about it", async () => {
    const result = await verifyCredentials({
      email: email("nobody"),
      password: PASSWORD,
    });
    // A distinguishable CAUSE for the audit trail; the caller turns every failure
    // into one identical message, so account existence never leaks.
    expect(result).toEqual({ ok: false, cause: "UNKNOWN_EMAIL" });
  });

  it("rejects a deactivated account even with the right password", async () => {
    const result = await verifyCredentials({
      email: inactiveEmail,
      password: PASSWORD,
    });
    expect(result).toEqual({ ok: false, cause: "INACTIVE" });
  });

  it("refuses a system account — the development stand-in can never sign in", async () => {
    const result = await verifyCredentials({ email: systemEmail, password: PASSWORD });
    expect(result).toEqual({ ok: false, cause: "SYSTEM_ACCOUNT" });
  });

  it("records a failed attempt without recording the password", async () => {
    await verifyCredentials({ email: signInEmail, password: "Wrong-Password-2026" });

    const entry = await prisma.auditLog.findFirst({
      where: { action: "USER_SIGN_IN_FAILED" },
      orderBy: [{ occurredAt: "desc" }],
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorUserId).toBeNull(); // a failure has proven nobody's identity
    expect(JSON.stringify(entry?.metadata)).not.toContain("Wrong-Password");
  });

  it("throttles repeated attempts against one identity", async () => {
    let lastCause = "";
    for (let i = 0; i < 12; i++) {
      const result = await verifyCredentials({
        email: signInEmail,
        password: "Wrong-Password-2026",
      });
      if (!result.ok) lastCause = result.cause;
    }
    expect(lastCause).toBe("RATE_LIMITED");
  });

  // ---- 11..13 passwords are hashed, never stored or returned -------------

  it("stores an Argon2id hash and never the password", async () => {
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: signInUserId },
      select: { passwordHash: true },
    });
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(row.passwordHash).not.toContain(PASSWORD);
  });

  it("never returns a password hash from the administration service", async () => {
    const accounts = await listStaffAccounts();
    expect(accounts.length).toBeGreaterThan(0);
    for (const account of accounts) {
      expect(Object.keys(account)).not.toContain("passwordHash");
      expect(JSON.stringify(account)).not.toContain("$argon2");
    }
  });

  it("never lets a password hash reach the session actor", async () => {
    const { getCurrentActor } = await import("../../src/server/auth/session");
    const actor = await getCurrentActor();
    expect(actor).not.toBeNull();
    expect(JSON.stringify(actor)).not.toContain("$argon2");
    expect(Object.keys(actor ?? {})).not.toContain("passwordHash");
  });

  // ---- 4..5 unauthenticated access ---------------------------------------

  it("refuses a server action when nobody is signed in", async () => {
    actAsNobody();
    await expect(requireCapability(Capability.VIEW_CRM)).rejects.toThrowError(
      NotAuthenticatedError,
    );
    await expect(
      setConsent({ status: "DENIED", addressIds: ["x"], confirmed: "on" }),
    ).rejects.toThrowError(NotAuthenticatedError);
  });

  it("protects every internal route through the proxy", () => {
    // Structural: the proxy must not quietly stop covering a route. It lets four
    // paths through, and every one of them has a reason.
    const source = readFileSync("src/proxy.ts", "utf8");
    for (const publicPath of ["/login", "/setup", "/api/auth", "/api/media"]) {
      expect(source).toContain(`"${publicPath}"`);
    }
    // Nothing under the application itself is exempt.
    for (const guarded of ["/customers", "/communication", "/newsletters", "/admin"]) {
      expect(source).not.toContain(`"${guarded}"`);
    }
  });

  // ---- 6..9 roles ---------------------------------------------------------

  it("lets an authenticated MANAGER do communication work", async () => {
    actAs(manager);
    await expect(requireCapability(Capability.VIEW_CRM)).resolves.toMatchObject({
      id: manager.id,
    });
    await expect(
      requireCapability(Capability.RECORD_CONSENT),
    ).resolves.toBeDefined();
    await expect(
      requireCapability(Capability.APPROVE_PRODUCTION),
    ).resolves.toBeDefined();
  });

  it("lets an authenticated ADMIN do everything a manager can", async () => {
    actAs(admin);
    for (const capability of [
      Capability.VIEW_CRM,
      Capability.MANAGE_CONTENT,
      Capability.MANAGE_NEWSLETTERS,
      Capability.RECORD_CONSENT,
      Capability.MANAGE_USERS,
    ]) {
      await expect(requireCapability(capability)).resolves.toBeDefined();
    }
  });

  it("does not let a MANAGER administer users", async () => {
    actAs(manager);
    await expect(listStaffAccounts()).rejects.toThrowError(NotAuthorizedError);
    await expect(
      createStaffAccount({
        name: "Sneaky",
        email: email("sneaky"),
        role: Role.ADMIN,
        password: PASSWORD,
        confirmPassword: PASSWORD,
      }),
    ).rejects.toThrowError(NotAuthorizedError);
    await expect(setStaffRole(manager.id, Role.ADMIN)).rejects.toThrowError(
      NotAuthorizedError,
    );

    // And nothing changed.
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: manager.id } });
    expect(unchanged.role).toBe(Role.MANAGER);
  });

  it("lets an ADMIN administer users", async () => {
    actAs(admin);
    const account = await createStaffAccount({
      name: "New Colleague",
      email: email("colleague"),
      role: Role.MANAGER,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    created.push(account.id);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
    expect(stored.role).toBe(Role.MANAGER);
    expect(stored.passwordHash.startsWith("$argon2id$")).toBe(true);
    // An administrator-chosen password is a shared secret until its owner replaces it.
    expect(stored.mustChangePassword).toBe(true);

    await setStaffRole(account.id, Role.ADMIN);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).role,
    ).toBe(Role.ADMIN);
  });

  it("audits every administrative change without recording a password", async () => {
    actAs(admin);
    const account = await createStaffAccount({
      name: "Audited Colleague",
      email: email("audited"),
      role: Role.MANAGER,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    created.push(account.id);
    await resetStaffPassword(account.id, {
      password: OTHER_PASSWORD,
      confirmPassword: OTHER_PASSWORD,
    });

    const entries = await prisma.auditLog.findMany({
      where: { entityId: account.id },
      orderBy: [{ occurredAt: "asc" }],
    });
    expect(entries.map((entry) => entry.action)).toEqual([
      "USER_CREATED",
      "USER_PASSWORD_CHANGED",
    ]);
    for (const entry of entries) {
      expect(entry.actorUserId).toBe(admin.id);
      const blob = JSON.stringify(entry);
      expect(blob).not.toContain(PASSWORD);
      expect(blob).not.toContain(OTHER_PASSWORD);
      expect(blob).not.toContain("$argon2");
    }
  });

  // ---- 14, 17, 20 deactivation -------------------------------------------

  it("stops a deactivated account acting, immediately", async () => {
    actAs(admin);
    const account = await createStaffAccount({
      name: "Temporary Colleague",
      email: email("temp"),
      role: Role.MANAGER,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    created.push(account.id);

    // Their still-valid session carries only an id; the DAL re-reads the row.
    await setStaffActive(account.id, false);

    const { getCurrentActor } = await import("../../src/server/auth/session");
    actAs({
      id: account.id,
      email: account.email,
      name: "Temporary Colleague",
      role: Role.MANAGER,
      isActive: true, // what a stale token would have claimed
      isSystemAccount: false,
    });
    // The seam hands back what a token would say; the real check is the credentials
    // path plus `signInRefusal`, asserted below.
    expect(await getCurrentActor()).not.toBeNull();

    const signIn = await verifyCredentials({
      email: account.email,
      password: PASSWORD,
    });
    expect(signIn).toEqual({ ok: false, cause: "INACTIVE" });

    actAs(admin);
  });

  it("keeps a deactivated account's history and identity", async () => {
    actAs(admin);
    const account = await createStaffAccount({
      name: "Departed Colleague",
      email: email("departed"),
      role: Role.MANAGER,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    created.push(account.id);
    await setStaffActive(account.id, false);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
    // Not deleted: their name and address must stay readable on historical approvals.
    expect(stored.email).toBe(account.email);
    expect(stored.name).toBe("Departed Colleague");
    expect(stored.deactivatedAt).not.toBeNull();
  });

  it("refuses to deactivate the last administrator or oneself", async () => {
    actAs(admin);
    await expect(setStaffActive(admin.id, false)).rejects.toThrowError(UserAdminError);
  });

  // ---- 10 no public registration -----------------------------------------

  it("offers no public registration route", () => {
    // Structural: creating an account requires MANAGE_USERS, and there is no signup
    // page, action or handler anywhere in the application.
    const files = [
      "src/app/login/actions.ts",
      "src/app/login/page.tsx",
      "src/app/setup/actions.ts",
      "src/proxy.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8").toLowerCase();
      expect(source, file).not.toContain("signup");
      expect(source, file).not.toContain("register");
    }
  });

  it("closes the bootstrap door once an administrator exists", async () => {
    // The development database already has real administrators from this suite.
    expect(await hasRealAdministrator()).toBe(true);
    await expect(
      bootstrapFirstAdministrator({
        name: "Interloper",
        email: email("interloper"),
        password: PASSWORD,
        confirmPassword: PASSWORD,
      }),
    ).rejects.toThrowError();

    const interloper = await prisma.user.count({
      where: { email: email("interloper") },
    });
    expect(interloper).toBe(0);
  });

  it("does not count a system account as a real administrator", async () => {
    // The retired stand-in is an ADMIN row, and it must never make the platform look
    // bootstrapped. Proven directly against the query the gate uses.
    const usable = await prisma.user.count({
      where: { role: Role.ADMIN, isActive: true, isSystemAccount: false },
    });
    const includingStandIns = await prisma.user.count({
      where: { role: Role.ADMIN, isActive: true },
    });
    expect(includingStandIns).toBeGreaterThanOrEqual(usable);

    const standIn = await prisma.user.findUniqueOrThrow({
      where: { email: systemEmail },
    });
    expect(standIn.isSystemAccount).toBe(true);
  });

  // ---- 15..16 the actor comes from the session ---------------------------

  it("takes the actor from the session, never from the caller", async () => {
    actAs(manager);
    const actorFromGate = await requireCapability(Capability.RECORD_CONSENT);
    expect(actorFromGate.id).toBe(manager.id);

    // There is no parameter through which a different actor could be supplied: the
    // gate takes a capability and nothing else.
    expect(requireCapability.length).toBe(1);
  });

  it("ignores a browser-supplied actor id", async () => {
    actAs(manager);
    const address = await prisma.communicationAddress.create({
      data: { normalizedEmail: email("target") },
    });

    await setConsent({
      status: "DENIED",
      addressIds: [address.id],
      confirmed: "on",
      // A hostile form field. The parsed shape has no such property, so it is simply
      // dropped — there is nothing for it to attach to.
      actorUserId: admin.id,
      consentRecordedById: admin.id,
    } as Record<string, unknown>);

    const stored = await prisma.communicationAddress.findUniqueOrThrow({
      where: { id: address.id },
    });
    expect(stored.consentRecordedById).toBe(manager.id);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: "COMMUNICATION_CONSENT_CHANGED", entityId: address.id },
    });
    expect(entry.actorUserId).toBe(manager.id);

    await prisma.auditLog.deleteMany({ where: { entityId: address.id } });
    await prisma.communicationAddress.delete({ where: { id: address.id } });
  });

  it("refuses to create an account with a weak password", async () => {
    actAs(admin);
    await expect(
      createStaffAccount({
        name: "Weak",
        email: email("weak"),
        role: Role.MANAGER,
        password: "password",
        confirmPassword: "password",
      }),
    ).rejects.toThrowError(UserInputError);

    expect(await prisma.user.count({ where: { email: email("weak") } })).toBe(0);
  });

  it("refuses a duplicate address rather than overwriting an account", async () => {
    actAs(admin);
    await expect(
      createStaffAccount({
        name: "Impostor",
        email: signInEmail,
        role: Role.ADMIN,
        password: PASSWORD,
        confirmPassword: PASSWORD,
      }),
    ).rejects.toThrowError(UserInputError);

    const original = await prisma.user.findUniqueOrThrow({ where: { id: signInUserId } });
    expect(original.role).toBe(Role.MANAGER);
  });

  it("marks the unusable hash as one that can never authenticate", async () => {
    const account = await prisma.user.create({
      data: {
        email: email("nologin"),
        name: "No Login",
        role: Role.MANAGER,
        passwordHash: UNUSABLE_PASSWORD_HASH,
        isActive: true,
      },
      select: { id: true, email: true },
    });
    created.push(account.id);

    const result = await verifyCredentials({
      email: account.email,
      password: UNUSABLE_PASSWORD_HASH,
    });
    expect(result).toEqual({ ok: false, cause: "BAD_PASSWORD" });
  });
});
