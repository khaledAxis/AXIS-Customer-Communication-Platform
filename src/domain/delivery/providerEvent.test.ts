import { describe, it, expect } from "vitest";

import { DeliveryState } from "./dispatchPolicy";
import {
  ProviderEventType,
  consequenceOf,
  mustSurviveConsent,
} from "./providerEvent";

describe("provider event consequences", () => {
  it("marks a delivered message delivered and nothing else", () => {
    expect(consequenceOf(ProviderEventType.DELIVERED)).toEqual({
      deliveryState: DeliveryState.DELIVERED,
      suppression: null,
      markEmailInvalid: false,
      unsubscribe: false,
    });
  });

  it("blocks the address on a hard bounce and records it as invalid", () => {
    // The mailbox does not exist: block future sends AND surface the data-quality
    // problem so staff can fix the address in Monday.
    expect(consequenceOf(ProviderEventType.HARD_BOUNCE)).toEqual({
      deliveryState: DeliveryState.BOUNCED,
      suppression: "HARD_BOUNCE",
      markEmailInvalid: true,
      unsubscribe: false,
    });
  });

  it("blocks the address on a complaint WITHOUT calling it invalid", () => {
    // Somebody who reports spam has a working mailbox. Marking it invalid would
    // corrupt the signal `emailStatus` exists to carry.
    const consequence = consequenceOf(ProviderEventType.COMPLAINT);
    expect(consequence.suppression).toBe("COMPLAINT");
    expect(consequence.markEmailInvalid).toBe(false);
    expect(consequence.deliveryState).toBe(DeliveryState.COMPLAINED);
  });

  it("does not block anyone on a soft bounce", () => {
    // A full mailbox is temporary and is not a reason to stop writing forever.
    expect(consequenceOf(ProviderEventType.SOFT_BOUNCE)).toEqual({
      deliveryState: null,
      suppression: null,
      markEmailInvalid: false,
      unsubscribe: false,
    });
  });

  it("records a provider-side unsubscribe as an unsubscribe", () => {
    const consequence = consequenceOf(ProviderEventType.UNSUBSCRIBE);
    expect(consequence.unsubscribe).toBe(true);
    expect(consequence.suppression).toBeNull();
  });

  it("marks a failure without suppressing the address", () => {
    expect(consequenceOf(ProviderEventType.FAILED)).toEqual({
      deliveryState: DeliveryState.FAILED,
      suppression: null,
      markEmailInvalid: false,
      unsubscribe: false,
    });
  });

  it("makes bounce and complaint outrank a recorded consent", () => {
    // Consent says AXIS may write; a complaint says this person does not want to be
    // written to. The second wins, and nothing may quietly re-enable the address.
    expect(mustSurviveConsent(consequenceOf(ProviderEventType.HARD_BOUNCE))).toBe(true);
    expect(mustSurviveConsent(consequenceOf(ProviderEventType.COMPLAINT))).toBe(true);
    expect(mustSurviveConsent(consequenceOf(ProviderEventType.DELIVERED))).toBe(false);
    expect(mustSurviveConsent(consequenceOf(ProviderEventType.SOFT_BOUNCE))).toBe(false);
  });

  it("never clears a suppression", () => {
    // There is no consequence that removes one. Re-enabling an address is a separate,
    // deliberate workflow, not something a webhook can do.
    for (const type of Object.values(ProviderEventType)) {
      const consequence = consequenceOf(type);
      expect(Object.keys(consequence).sort()).toEqual([
        "deliveryState",
        "markEmailInvalid",
        "suppression",
        "unsubscribe",
      ]);
      expect(consequence.suppression === null || typeof consequence.suppression === "string").toBe(
        true,
      );
    }
  });

  it("covers every event type exhaustively", () => {
    for (const type of Object.values(ProviderEventType)) {
      expect(() => consequenceOf(type), type).not.toThrow();
    }
  });
});
