import { describe, it, expect } from "vitest";

import {
  CAPABILITIES_BY_ROLE,
  Capability,
  NotAuthenticatedError,
  NotAuthorizedError,
  PasswordChangeRequiredError,
  Role,
  assertCan,
  can,
  isRole,
  signInRefusal,
  type Actor,
} from "./authorization";

function actor(over: Partial<Actor> = {}): Actor {
  return {
    id: "u1",
    email: "person@axis-gps.com",
    name: "A Person",
    role: Role.MANAGER,
    isActive: true,
    isSystemAccount: false,
    mustChangePassword: false,
    ...over,
  };
}

describe("roles", () => {
  it("recognises only the two real roles", () => {
    expect(isRole("ADMIN")).toBe(true);
    expect(isRole("MANAGER")).toBe(true);
    expect(isRole("SUPERUSER")).toBe(false);
    expect(isRole(null)).toBe(false);
  });

  it("gives a manager the whole communication workflow", () => {
    const manager = actor({ role: Role.MANAGER });
    for (const capability of [
      Capability.VIEW_CRM,
      Capability.MANAGE_CONTENT,
      Capability.MANAGE_NEWSLETTERS,
      Capability.MANAGE_SEGMENTS,
      Capability.MANAGE_COMMUNICATION_LANGUAGE,
      Capability.RECORD_CONSENT,
      Capability.PREPARE_FINAL_AUDIENCE,
      Capability.APPROVE_PRODUCTION,
      Capability.SEND_TEST_EMAIL,
      Capability.RUN_CRM_SYNC,
    ]) {
      expect(can(manager, capability), capability).toBe(true);
    }
  });

  it("does not let a manager administer accounts", () => {
    expect(can(actor({ role: Role.MANAGER }), Capability.MANAGE_USERS)).toBe(false);
  });

  it("lets an administrator administer accounts", () => {
    expect(can(actor({ role: Role.ADMIN }), Capability.MANAGE_USERS)).toBe(true);
  });

  it("gives an administrator everything a manager has, and nothing subtracted", () => {
    for (const capability of CAPABILITIES_BY_ROLE.MANAGER) {
      expect(CAPABILITIES_BY_ROLE.ADMIN, capability).toContain(capability);
    }
  });

  it("adds only INFRASTRUCTURE capabilities for an administrator", () => {
    const extra = CAPABILITIES_BY_ROLE.ADMIN.filter(
      (capability) => !CAPABILITIES_BY_ROLE.MANAGER.includes(capability),
    );
    // "Administrator" must not quietly become a way around a BUSINESS rule. The
    // extras are both infrastructure: who may sign in (ADR-0023), and which external
    // URL this server may fetch (ADR-0026). Neither approves, sends, or decides who
    // receives an email — an ADMIN is still bound by four-eyes and by the send gate.
    expect([...extra].sort()).toEqual(
      [Capability.MANAGE_USERS, Capability.MANAGE_CONTENT_SOURCES].sort(),
    );
  });

  it("keeps every SENDING and APPROVAL capability shared, never admin-only", () => {
    // The real invariant behind the test above: nothing an administrator holds alone
    // may touch approval or delivery.
    for (const capability of [
      Capability.APPROVE_PRODUCTION,
      Capability.PREPARE_FINAL_AUDIENCE,
      Capability.SEND_TEST_EMAIL,
    ]) {
      expect(CAPABILITIES_BY_ROLE.MANAGER).toContain(capability);
    }
  });

  it("does not let a manager add a content source", () => {
    // Supplying a URL the server will fetch is an infrastructure act (ADR-0026).
    expect(can(actor({ role: Role.MANAGER }), Capability.MANAGE_CONTENT_SOURCES)).toBe(
      false,
    );
    expect(can(actor({ role: Role.ADMIN }), Capability.MANAGE_CONTENT_SOURCES)).toBe(
      true,
    );
  });
});

describe("who may act at all", () => {
  it("grants nothing to an anonymous caller", () => {
    expect(can(null, Capability.VIEW_CRM)).toBe(false);
    expect(can(undefined, Capability.VIEW_CRM)).toBe(false);
  });

  it("grants nothing to a deactivated account, whatever its role", () => {
    expect(can(actor({ role: Role.ADMIN, isActive: false }), Capability.VIEW_CRM)).toBe(
      false,
    );
    expect(
      can(actor({ role: Role.ADMIN, isActive: false }), Capability.MANAGE_USERS),
    ).toBe(false);
  });

  it("grants nothing to a system account, whatever its role", () => {
    const standIn = actor({ role: Role.ADMIN, isSystemAccount: true });
    for (const capability of CAPABILITIES_BY_ROLE.ADMIN) {
      expect(can(standIn, capability), capability).toBe(false);
    }
  });

  it("grants nothing while an administrator-issued password is unchanged", () => {
    // A shared secret must not be able to approve a newsletter or record consent
    // (ADR-0024). The only thing its holder may do is replace it.
    const pending = actor({ role: Role.ADMIN, mustChangePassword: true });
    for (const capability of CAPABILITIES_BY_ROLE.ADMIN) {
      expect(can(pending, capability), capability).toBe(false);
    }
  });
});

describe("assertCan", () => {
  it("returns the actor when allowed", () => {
    const person = actor({ role: Role.ADMIN });
    expect(assertCan(person, Capability.MANAGE_USERS)).toBe(person);
  });

  it("distinguishes 'not signed in' from 'not allowed'", () => {
    expect(() => assertCan(null, Capability.VIEW_CRM)).toThrowError(
      NotAuthenticatedError,
    );
    expect(() => assertCan(actor(), Capability.MANAGE_USERS)).toThrowError(
      NotAuthorizedError,
    );
  });

  it("distinguishes 'must change password' from both", () => {
    // A refusal and a step the person can take right now need different answers.
    expect(() =>
      assertCan(actor({ mustChangePassword: true }), Capability.VIEW_CRM),
    ).toThrowError(PasswordChangeRequiredError);
  });

  it("names the capability on the refusal, for the audit trail", () => {
    try {
      assertCan(actor(), Capability.MANAGE_USERS);
      expect.unreachable();
    } catch (error) {
      expect((error as NotAuthorizedError).capability).toBe(Capability.MANAGE_USERS);
      // The message a person sees says nothing about internals.
      expect((error as Error).message).not.toContain("MANAGE_USERS");
    }
  });
});

describe("who may sign in", () => {
  it("admits an ordinary active account", () => {
    expect(signInRefusal({ isActive: true, isSystemAccount: false })).toBeNull();
  });

  it("refuses a deactivated account", () => {
    expect(signInRefusal({ isActive: false, isSystemAccount: false })).toBe("INACTIVE");
  });

  it("refuses a system account even when it looks active", () => {
    // The retired development stand-in must never become a live session, whatever
    // else changes about it.
    expect(signInRefusal({ isActive: true, isSystemAccount: true })).toBe(
      "SYSTEM_ACCOUNT",
    );
  });
});
