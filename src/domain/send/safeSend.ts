/**
 * Server-side safe-send resolver (ADR-0008 / ADR-0009 §M).
 *
 * The DATABASE is the duplicate-send guard; THIS function is the delivery-address
 * guard. In TEST mode the effective provider destination is ALWAYS the configured
 * safe-send address — a real CRM address can never be produced as the provider
 * destination. Switching to PRODUCTION is an explicit configuration decision made
 * elsewhere; this pure function only maps (mode, intended) -> effective delivery.
 *
 * No email is sent here; this returns the addresses a provider adapter would use.
 */

export type SendMode = "TEST" | "PRODUCTION";

export interface SafeSendConfig {
  mode: SendMode;
  safeFrom: string; // e.g. axisgpscana@gmail.com
  safeRedirectTo: string; // e.g. khaled-s@axis-gps.com
  productionFrom?: string; // real sender used only in PRODUCTION (defaults to safeFrom)
}

export interface EffectiveDelivery {
  fromEmail: string;
  /** The address actually handed to the email provider. */
  toEmail: string;
  /** The real intended recipient (for preview/audit only). */
  intendedEmail: string;
  isRedirected: boolean;
  mode: SendMode;
}

export function resolveDelivery(
  intendedEmail: string,
  cfg: SafeSendConfig,
): EffectiveDelivery {
  if (cfg.mode === "TEST") {
    return {
      fromEmail: cfg.safeFrom,
      toEmail: cfg.safeRedirectTo, // never the real CRM address
      intendedEmail,
      isRedirected: true,
      mode: "TEST",
    };
  }
  return {
    fromEmail: cfg.productionFrom ?? cfg.safeFrom,
    toEmail: intendedEmail,
    intendedEmail,
    isRedirected: false,
    mode: "PRODUCTION",
  };
}

/** TEST is the default; production must be explicitly configured. */
export function defaultSendMode(): SendMode {
  return "TEST";
}
