/**
 * Who may do what (ADR-0023).
 *
 * One capability matrix, expressed once, in pure code. Services ask this module;
 * they never re-derive a rule from a role string, and the UI only ever mirrors an
 * answer it was given. Hiding a button is presentation — the server asks this.
 *
 * Pure: no I/O, no session handling, no framework imports.
 */

export const Role = { ADMIN: "ADMIN", MANAGER: "MANAGER" } as const;
export type Role = (typeof Role)[keyof typeof Role];

export function isRole(value: unknown): value is Role {
  return value === Role.ADMIN || value === Role.MANAGER;
}

/**
 * Every distinct thing a signed-in person can do. Adding one is a deliberate
 * decision recorded here, not an `if (role === "ADMIN")` scattered through a service.
 */
export const Capability = {
  VIEW_CRM: "VIEW_CRM",
  MANAGE_CONTENT: "MANAGE_CONTENT",
  MANAGE_NEWSLETTERS: "MANAGE_NEWSLETTERS",
  MANAGE_SEGMENTS: "MANAGE_SEGMENTS",
  MANAGE_COMMUNICATION_LANGUAGE: "MANAGE_COMMUNICATION_LANGUAGE",
  RECORD_CONSENT: "RECORD_CONSENT",
  PREPARE_FINAL_AUDIENCE: "PREPARE_FINAL_AUDIENCE",
  APPROVE_PRODUCTION: "APPROVE_PRODUCTION",
  SEND_TEST_EMAIL: "SEND_TEST_EMAIL",
  RUN_CRM_SYNC: "RUN_CRM_SYNC",
  MANAGE_USERS: "MANAGE_USERS",
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];

/**
 * MANAGER runs the communication business end to end. ADMIN adds account
 * administration on top — and nothing else, because "administrator" must not quietly
 * become a way around a business rule.
 */
const MANAGER_CAPABILITIES: readonly Capability[] = [
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
];

const ADMIN_ONLY_CAPABILITIES: readonly Capability[] = [Capability.MANAGE_USERS];

export const CAPABILITIES_BY_ROLE: Record<Role, readonly Capability[]> = {
  MANAGER: MANAGER_CAPABILITIES,
  ADMIN: [...MANAGER_CAPABILITIES, ...ADMIN_ONLY_CAPABILITIES],
};

/** The actor a server-side check is given. Never built from client input. */
export interface Actor {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  isActive: boolean;
  /**
   * A non-human historical account (the pre-authentication development stand-in).
   * It can never sign in, so in practice this is never true for a live session —
   * the flag exists so any code that somehow receives one still refuses it.
   */
  isSystemAccount: boolean;
  /**
   * An administrator issued this password and its owner has not replaced it yet
   * (ADR-0024). Until they do, the account holds NO capability — a shared secret must
   * not be able to approve a newsletter or record consent.
   */
  mustChangePassword: boolean;
}

export function can(actor: Actor | null | undefined, capability: Capability): boolean {
  if (!actor) return false;
  // A deactivated or system account has no capabilities at all, whatever its role
  // says. Role is what someone may do; these three decide whether they may act.
  if (!actor.isActive || actor.isSystemAccount) return false;
  // An administrator-issued password is a secret two people know. Nothing may be done
  // with it except replace it (ADR-0024).
  if (actor.mustChangePassword) return false;
  return CAPABILITIES_BY_ROLE[actor.role].includes(capability);
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Please sign in to continue.");
    this.name = "NotAuthenticatedError";
  }
}

/** Signed in, but the account must replace an administrator-issued password first. */
export class PasswordChangeRequiredError extends Error {
  constructor() {
    super("Choose your own password before continuing.");
    this.name = "PasswordChangeRequiredError";
  }
}

export class NotAuthorizedError extends Error {
  readonly capability: Capability;

  constructor(capability: Capability) {
    super("You do not have permission to do that.");
    this.name = "NotAuthorizedError";
    this.capability = capability;
  }
}

/** Throwing form for services: the last gate before a mutation. */
export function assertCan(
  actor: Actor | null | undefined,
  capability: Capability,
): Actor {
  if (!actor) throw new NotAuthenticatedError();
  // Reported separately from "not allowed", because the two need different answers:
  // one is a refusal, the other is a step the person can take right now.
  if (actor.mustChangePassword) throw new PasswordChangeRequiredError();
  if (!can(actor, capability)) throw new NotAuthorizedError(capability);
  return actor;
}

/**
 * Whether an account is allowed to authenticate at all.
 *
 * Separate from `can()` on purpose: this is the question the login path asks, before
 * any capability exists. A system account is refused here so the development
 * stand-in can never become a live session no matter what else changes.
 */
export type SignInRefusal = "INACTIVE" | "SYSTEM_ACCOUNT";

export function signInRefusal(user: {
  isActive: boolean;
  isSystemAccount: boolean;
}): SignInRefusal | null {
  if (user.isSystemAccount) return "SYSTEM_ACCOUNT";
  if (!user.isActive) return "INACTIVE";
  return null;
}
