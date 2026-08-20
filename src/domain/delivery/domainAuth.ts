/**
 * Sending-domain authentication: what the provider reported, and what AXIS must
 * publish in DNS (ADR-0025).
 *
 * Pure: no I/O, no DNS lookups, no provider SDK. It interprets a provider's answer —
 * it never guesses one. A domain is reported VERIFIED only because the provider said
 * so; local configuration cannot make that claim.
 *
 * SPF and DKIM come FROM the provider. **DMARC does not** — it is AXIS's own policy
 * about how receivers should treat mail that fails alignment, and no provider can
 * publish it on AXIS's behalf. That asymmetry is why DMARC is handled separately here.
 */

export type MechanismState = "VERIFIED" | "NOT_VERIFIED" | "UNKNOWN";

/** One DNS record the provider asks AXIS to publish. Public data, never a secret. */
export interface RequiredDnsRecord {
  /** SPF | DKIM | verification | tracking — which mechanism this record serves. */
  purpose: "SPF" | "DKIM" | "VERIFICATION" | "TRACKING" | "OTHER";
  type: string;
  /** Host/name, as the provider gives it. */
  name: string;
  value: string;
  ttl: string | null;
  priority: number | null;
  /** The provider's own per-record status, when it reports one. */
  status: string | null;
}

export interface ProviderDomainReport {
  domain: string;
  /** The provider's status string, verbatim. */
  status: string;
  records: RequiredDnsRecord[];
}

export interface DomainAuthStatus {
  domain: string | null;
  /** Provider status, verbatim, so the UI never has to guess what it meant. */
  providerStatus: string | null;
  spf: MechanismState;
  dkim: MechanismState;
  /**
   * Always UNKNOWN from a provider report. AXIS publishes DMARC itself, so the only
   * honest answer here is "we have not checked", and the admin screen says so.
   */
  dmarc: MechanismState;
  /** True only when the provider says the whole domain is verified. */
  verified: boolean;
  records: RequiredDnsRecord[];
}

/** Nothing has been checked. Never presented as "not verified" — it is "unknown". */
export function unknownDomainAuth(domain: string | null = null): DomainAuthStatus {
  return {
    domain,
    providerStatus: null,
    spf: "UNKNOWN",
    dkim: "UNKNOWN",
    dmarc: "UNKNOWN",
    verified: false,
    records: [],
  };
}

/**
 * A record counts as verified only when the provider says that exact word. Anything
 * else — pending, failed, missing, a status we do not recognise — is NOT_VERIFIED.
 * Failing towards "not verified" is the only safe direction.
 */
function recordState(records: RequiredDnsRecord[], purpose: "SPF" | "DKIM"): MechanismState {
  const relevant = records.filter((record) => record.purpose === purpose);
  if (relevant.length === 0) return "UNKNOWN";
  return relevant.every((record) => record.status?.toLowerCase() === "verified")
    ? "VERIFIED"
    : "NOT_VERIFIED";
}

export function interpretDomainReport(report: ProviderDomainReport): DomainAuthStatus {
  const verified = report.status.toLowerCase() === "verified";

  return {
    domain: report.domain,
    providerStatus: report.status,
    // When the provider declares the whole domain verified, its mechanisms are too —
    // some providers stop reporting per-record status once that happens.
    spf: verified ? "VERIFIED" : recordState(report.records, "SPF"),
    dkim: verified ? "VERIFIED" : recordState(report.records, "DKIM"),
    dmarc: "UNKNOWN",
    verified,
    records: report.records,
  };
}

// ---------------------------------------------------------------------------
// DMARC guidance
// ---------------------------------------------------------------------------

export interface DmarcRecommendation {
  /** The host the TXT record goes on. */
  host: string;
  /** Stage 1 — observe only. Never start at reject. */
  value: string;
  stages: { policy: string; when: string; value: string }[];
  notes: string[];
}

/**
 * A staged rollout, not a policy change on day one.
 *
 * `p=reject` on an unaligned domain silently destroys legitimate mail — invoices,
 * quotes, anything sent through a system nobody remembered. The only responsible
 * sequence is observe, then quarantine, then reject, with reports read in between.
 */
export function recommendDmarc(
  domain: string,
  reportTo: string,
): DmarcRecommendation {
  const host = `_dmarc.${domain}`;
  const observe = `v=DMARC1; p=none; rua=mailto:${reportTo}; fo=1; adkim=r; aspf=r`;

  return {
    host,
    value: observe,
    stages: [
      {
        policy: "p=none",
        when: "Start here. Publish, then read the aggregate reports for 2–4 weeks.",
        value: observe,
      },
      {
        policy: "p=quarantine",
        when: "Once every legitimate sender for this domain shows SPF or DKIM alignment.",
        value: `v=DMARC1; p=quarantine; pct=25; rua=mailto:${reportTo}; fo=1`,
      },
      {
        policy: "p=reject",
        when: "Only after a full quarantine period with no legitimate mail affected.",
        value: `v=DMARC1; p=reject; rua=mailto:${reportTo}; fo=1`,
      },
    ],
    notes: [
      "DMARC is AXIS's own policy — no email provider can publish it for you.",
      "Never begin at p=reject: unaligned legitimate mail is discarded silently, and you find out from the customer who never received an invoice.",
      "One _dmarc record per domain. A subdomain inherits the organisational policy unless it publishes its own.",
    ],
  };
}

// ---------------------------------------------------------------------------
// SPF merge guidance
// ---------------------------------------------------------------------------

export interface SpfGuidance {
  /** True when the domain already publishes an SPF record. */
  hasExisting: boolean;
  existing: string | null;
  /** What to publish, given what is already there. */
  recommended: string | null;
  warnings: string[];
}

/**
 * How to add a provider to SPF WITHOUT breaking what is already sending.
 *
 * A domain may publish exactly ONE SPF record. Two is not "more permissive" — it is a
 * permanent error that fails every check, so a provider's include has to be merged
 * into the existing policy rather than published alongside it.
 */
export function planSpfMerge(
  existingSpf: string | null,
  providerInclude: string,
): SpfGuidance {
  if (!existingSpf || existingSpf.trim() === "") {
    return {
      hasExisting: false,
      existing: null,
      recommended: `v=spf1 ${providerInclude} ~all`,
      warnings: [
        "No existing SPF record was supplied. Check DNS before publishing — if one already exists, it must be MERGED, never duplicated.",
      ],
    };
  }

  const existing = existingSpf.trim();
  const warnings: string[] = [];

  if (existing.includes(providerInclude)) {
    return {
      hasExisting: true,
      existing,
      recommended: existing,
      warnings: ["The provider is already authorised by the existing SPF record."],
    };
  }

  // Insert the include before the terminal "all" mechanism, which must stay last.
  const allMatch = existing.match(/\s([-~?+]?all)\s*$/i);
  const recommended = allMatch
    ? existing.replace(/\s([-~?+]?all)\s*$/i, ` ${providerInclude} $1`)
    : `${existing} ${providerInclude}`;

  warnings.push(
    "A domain may publish only ONE SPF record. Replace the existing TXT record with the merged value below — do not add a second one.",
  );
  if (!allMatch) {
    warnings.push(
      "The existing record has no terminal `all` mechanism. Review it by hand before publishing.",
    );
  }
  if ((existing.match(/include:/g) ?? []).length >= 9) {
    warnings.push(
      "SPF allows at most 10 DNS lookups. This record is close to the limit, and exceeding it makes SPF fail permanently.",
    );
  }

  return { hasExisting: true, existing, recommended, warnings };
}
