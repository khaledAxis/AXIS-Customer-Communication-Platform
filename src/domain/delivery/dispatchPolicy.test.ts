import { describe, it, expect } from "vitest";

import {
  DeliveryState,
  IllegalDeliveryTransitionError,
  assertTransition,
  canTransition,
  decideDispatch,
  isSubmittable,
  isTerminal,
  type DispatchVetoFacts,
} from "./dispatchPolicy";
import { ConsentStatus, EmailStatus, Language } from "../types";

function facts(over: Partial<DispatchVetoFacts> = {}): DispatchVetoFacts {
  return {
    isUnsubscribed: false,
    isSuppressed: false,
    emailStatus: EmailStatus.VALID,
    language: Language.HE,
    consentStatus: ConsentStatus.GRANTED,
    ...over,
  };
}

describe("dispatch-time vetoes", () => {
  it("sends when nothing objects", () => {
    expect(
      decideDispatch({ facts: facts(), requireLanguage: Language.HE }),
    ).toEqual({ send: true });
  });

  it("stops an address that unsubscribed after approval", () => {
    expect(
      decideDispatch({
        facts: facts({ isUnsubscribed: true }),
        requireLanguage: Language.HE,
      }),
    ).toEqual({ send: false, reason: "UNSUBSCRIBED" });
  });

  it("keeps unsubscribe stronger than a granted consent", () => {
    // The whole reason the veto is re-read at dispatch: approval is a statement about
    // the past, and somebody may have opted out since.
    expect(
      decideDispatch({
        facts: facts({ isUnsubscribed: true, consentStatus: ConsentStatus.GRANTED }),
        requireLanguage: null,
      }),
    ).toEqual({ send: false, reason: "UNSUBSCRIBED" });
  });

  it("stops a suppressed address, even with granted consent", () => {
    expect(
      decideDispatch({
        facts: facts({ isSuppressed: true, consentStatus: ConsentStatus.GRANTED }),
        requireLanguage: null,
      }),
    ).toEqual({ send: false, reason: "SUPPRESSED" });
  });

  it("stops a known-invalid address", () => {
    expect(
      decideDispatch({
        facts: facts({ emailStatus: EmailStatus.INVALID }),
        requireLanguage: null,
      }),
    ).toEqual({ send: false, reason: "INVALID_EMAIL" });
  });

  it("stops a refused consent", () => {
    expect(
      decideDispatch({
        facts: facts({ consentStatus: ConsentStatus.DENIED }),
        requireLanguage: null,
      }),
    ).toEqual({ send: false, reason: "CONSENT_DENIED" });
  });

  it("stops a language mismatch for a localized campaign", () => {
    expect(
      decideDispatch({
        facts: facts({ language: Language.AR }),
        requireLanguage: Language.HE,
      }),
    ).toEqual({ send: false, reason: "LANGUAGE_UNKNOWN" });

    expect(
      decideDispatch({
        facts: facts({ language: Language.UNKNOWN }),
        requireLanguage: Language.HE,
      }),
    ).toEqual({ send: false, reason: "LANGUAGE_UNKNOWN" });
  });

  it("ignores language when the campaign is not localized", () => {
    expect(
      decideDispatch({
        facts: facts({ language: Language.UNKNOWN }),
        requireLanguage: null,
      }),
    ).toEqual({ send: true });
  });

  it("keeps unconfirmed consent passable by default, as elsewhere", () => {
    expect(
      decideDispatch({
        facts: facts({ consentStatus: ConsentStatus.UNKNOWN }),
        requireLanguage: null,
      }),
    ).toEqual({ send: true });

    expect(
      decideDispatch({
        facts: facts({ consentStatus: ConsentStatus.UNKNOWN }),
        requireLanguage: null,
        requireExplicitConsent: true,
      }),
    ).toEqual({ send: false, reason: "CONSENT_NOT_CONFIRMED" });
  });

  it("reports the strongest veto first", () => {
    // Everything is wrong at once; unsubscribe is what the recipient is told about.
    expect(
      decideDispatch({
        facts: facts({
          isUnsubscribed: true,
          isSuppressed: true,
          emailStatus: EmailStatus.INVALID,
          consentStatus: ConsentStatus.DENIED,
          language: Language.AR,
        }),
        requireLanguage: Language.HE,
      }),
    ).toEqual({ send: false, reason: "UNSUBSCRIBED" });
  });

  it("can only ever remove a recipient, never add one", () => {
    // There is no input through which a new address could enter, and no outcome that
    // names one. The only outputs are "send this one" or "do not".
    const decision = decideDispatch({ facts: facts(), requireLanguage: null });
    expect(Object.keys(decision)).toEqual(["send"]);
  });
});

describe("delivery state machine", () => {
  it("allows the normal path from prepared to accepted", () => {
    expect(canTransition(DeliveryState.PENDING, DeliveryState.READY)).toBe(true);
    expect(canTransition(DeliveryState.READY, DeliveryState.SENDING)).toBe(true);
    expect(canTransition(DeliveryState.SENDING, DeliveryState.ACCEPTED)).toBe(true);
  });

  it("keeps ACCEPTED distinct from DELIVERED", () => {
    // A provider taking responsibility is not a recipient receiving anything. Only a
    // provider event may make the second claim.
    expect(canTransition(DeliveryState.SENDING, DeliveryState.DELIVERED)).toBe(false);
    expect(canTransition(DeliveryState.ACCEPTED, DeliveryState.DELIVERED)).toBe(true);
  });

  it("never lets an UNCERTAIN delivery be re-sent", () => {
    // This is the rule that stops a customer receiving the same newsletter twice.
    expect(canTransition(DeliveryState.UNCERTAIN, DeliveryState.READY)).toBe(false);
    expect(canTransition(DeliveryState.UNCERTAIN, DeliveryState.SENDING)).toBe(false);
    expect(isSubmittable(DeliveryState.UNCERTAIN)).toBe(false);
  });

  it("lets an UNCERTAIN delivery be resolved by a provider event", () => {
    for (const to of [
      DeliveryState.DELIVERED,
      DeliveryState.BOUNCED,
      DeliveryState.COMPLAINED,
      DeliveryState.FAILED,
    ]) {
      expect(canTransition(DeliveryState.UNCERTAIN, to), to).toBe(true);
    }
  });

  it("treats only READY as submittable", () => {
    expect(isSubmittable(DeliveryState.READY)).toBe(true);
    for (const state of [
      DeliveryState.PENDING,
      DeliveryState.SENDING,
      DeliveryState.ACCEPTED,
      DeliveryState.DELIVERED,
      DeliveryState.BOUNCED,
      DeliveryState.COMPLAINED,
      DeliveryState.SUPPRESSED,
      DeliveryState.UNCERTAIN,
    ]) {
      expect(isSubmittable(state), state).toBe(false);
    }
  });

  it("makes a suppressed destination terminal", () => {
    expect(isTerminal(DeliveryState.SUPPRESSED)).toBe(true);
    expect(canTransition(DeliveryState.SUPPRESSED, DeliveryState.READY)).toBe(false);
    expect(canTransition(DeliveryState.SUPPRESSED, DeliveryState.SENDING)).toBe(false);
  });

  it("makes a bounce and a complaint terminal", () => {
    expect(isTerminal(DeliveryState.BOUNCED)).toBe(true);
    expect(isTerminal(DeliveryState.COMPLAINED)).toBe(true);
    expect(canTransition(DeliveryState.BOUNCED, DeliveryState.READY)).toBe(false);
  });

  it("allows a definite failure to be retried once fixed", () => {
    expect(canTransition(DeliveryState.FAILED, DeliveryState.READY)).toBe(true);
  });

  it("throws on an illegal transition rather than silently allowing it", () => {
    expect(() =>
      assertTransition(DeliveryState.PENDING, DeliveryState.DELIVERED),
    ).toThrowError(IllegalDeliveryTransitionError);
    expect(() =>
      assertTransition(DeliveryState.READY, DeliveryState.SENDING),
    ).not.toThrow();
  });
});
