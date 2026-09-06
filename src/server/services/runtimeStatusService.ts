import "server-only";
/** Display only. Every delivery still performs the complete service-side release checks. */
export function customerDeliveryConfigured() {
  return process.env.PRODUCTION_DELIVERY_ENABLED === "true" && process.env.SEND_MODE === "PRODUCTION" &&
    process.env.AXIS_DELIVERY_RELEASE_APPROVED === "true";
}
