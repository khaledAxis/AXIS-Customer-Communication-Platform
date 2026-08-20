/**
 * Which URLs this platform is permitted to fetch (ADR-0026).
 *
 * A content source is a URL supplied by a person and stored in a row, and the server
 * later fetches it. That is the exact shape of an SSRF vulnerability: the attacker
 * chooses a destination, and the server — which sits inside AXIS's network, with
 * whatever the cloud host grants it — makes the request on their behalf. A URL naming
 * `169.254.169.254`, `localhost`, or an internal hostname would turn this feature into
 * a way to read credentials the browser could never reach.
 *
 * So the rule is an ALLOW-LIST of shapes, not a block-list of known-bad strings:
 * public http(s), a real public host, no credentials, no non-standard port.
 *
 * This module is PURE — it judges a URL's shape and cannot resolve DNS. That is only
 * half the defence, and deliberately so: a hostname that looks public can still resolve
 * to `10.0.0.5`. The fetcher in `server/integrations/content` re-checks the RESOLVED
 * address, and re-checks every redirect hop. Both halves are required.
 */

export type SourceUrlProblem =
  | "EMPTY"
  | "MALFORMED"
  | "NOT_HTTP"
  | "HAS_CREDENTIALS"
  | "LOOPBACK_HOST"
  | "PRIVATE_ADDRESS"
  | "METADATA_ENDPOINT"
  | "INTERNAL_HOSTNAME"
  | "NON_STANDARD_PORT";

export const SOURCE_URL_PROBLEM_MESSAGE: Record<SourceUrlProblem, string> = {
  EMPTY: "Enter the address of the feed.",
  MALFORMED: "That is not a valid web address.",
  NOT_HTTP: "Only http:// and https:// addresses can be used as a content source.",
  HAS_CREDENTIALS:
    "A content source address must not contain a username or password.",
  LOOPBACK_HOST:
    "That address points at this server itself, so it cannot be used as a content source.",
  PRIVATE_ADDRESS:
    "That address is inside a private network. Content sources must be public websites.",
  METADATA_ENDPOINT:
    "That address is a cloud metadata service and can never be used as a content source.",
  INTERNAL_HOSTNAME:
    "That address only resolves inside a private network. Content sources must be public websites.",
  NON_STANDARD_PORT:
    "Content sources must use the standard web ports (80 or 443).",
};

export type SourceUrlResult =
  | { ok: true; url: string; hostname: string; isHttps: boolean }
  | { ok: false; problem: SourceUrlProblem; message: string };

/**
 * Cloud instance-metadata endpoints.
 *
 * `169.254.169.254` is caught by the link-local rule below as well; it is named here
 * so the refusal explains itself, and because this is the single most valuable target
 * an SSRF can reach.
 */
const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "100.100.100.200", // Alibaba Cloud
]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::", "::1"]);

/** RFC1918, loopback, link-local, CGNAT, and the "this network" block. */
export function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".");
  if (octets.length !== 4) return false;

  const numbers = octets.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : Number.NaN,
  );
  if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  const [a, b] = numbers;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local — includes cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * Private / non-routable IPv6, including the IPv4-mapped forms.
 *
 * `::ffff:127.0.0.1` and `::ffff:7f00:1` are the same loopback address wearing a
 * different hat, and a check that only understood dotted-quad notation would wave
 * both through.
 */
export function isPrivateIpv6(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host.includes(":")) return false;

  if (host === "::" || host === "::1") return true;
  if (host.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(host)) return true; // fc00::/7 unique local

  // IPv4-mapped: ::ffff:a.b.c.d or ::ffff:7f00:1
  const mapped = host.match(/^::ffff:(.+)$/);
  if (mapped) {
    const inner = mapped[1];
    if (inner.includes(".")) return isPrivateIpv4(inner);
    const parts = inner.split(":");
    if (parts.length === 2) {
      const high = Number.parseInt(parts[0], 16);
      const low = Number.parseInt(parts[1], 16);
      if (Number.isFinite(high) && Number.isFinite(low)) {
        const dotted = [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
        return isPrivateIpv4(dotted);
      }
    }
    return true; // unrecognised mapped form — refuse rather than guess
  }

  return false;
}

/** Names that only ever resolve inside a network. */
function isInternalHostname(hostname: string): boolean {
  return (
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localdomain") ||
    hostname.endsWith(".home.arpa") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".intranet") ||
    hostname.endsWith(".corp") ||
    hostname.endsWith(".localhost") ||
    // A bare label with no dot cannot be a public site: "intranet", "wiki", "gateway".
    !hostname.includes(".")
  );
}

/**
 * Judges a candidate source URL.
 *
 * REFUSES rather than repairs. A URL with embedded credentials is not stripped and
 * kept; a URL on port 8080 is not rewritten to 443. Somebody who typed either meant
 * something this feature does not do, and quietly changing it hides that.
 */
export function validateSourceUrl(raw: unknown): SourceUrlResult {
  const fail = (problem: SourceUrlProblem): SourceUrlResult => ({
    ok: false,
    problem,
    message: SOURCE_URL_PROBLEM_MESSAGE[problem],
  });

  if (typeof raw !== "string" || raw.trim() === "") return fail("EMPTY");

  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return fail("MALFORMED");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    // Also refuses file:, ftp:, gopher:, data: — every classic SSRF escape hatch.
    return fail("NOT_HTTP");
  }

  // `user:pass@host` would send AXIS-supplied credentials to whoever owns the host.
  if (parsed.username !== "" || parsed.password !== "") {
    return fail("HAS_CREDENTIALS");
  }

  if (parsed.port !== "" && parsed.port !== "80" && parsed.port !== "443") {
    // Port 6379, 5432, 9200… are the interesting ones, and no public feed needs them.
    return fail("NON_STANDARD_PORT");
  }

  const hostname = parsed.hostname.toLowerCase();

  if (METADATA_HOSTS.has(hostname)) return fail("METADATA_ENDPOINT");
  if (LOOPBACK_HOSTS.has(hostname)) return fail("LOOPBACK_HOST");
  if (hostname === "[::1]" || hostname === "[::]") return fail("LOOPBACK_HOST");
  if (isPrivateIpv4(hostname)) return fail("PRIVATE_ADDRESS");
  if (isPrivateIpv6(hostname)) return fail("PRIVATE_ADDRESS");
  if (isInternalHostname(hostname)) return fail("INTERNAL_HOSTNAME");

  return {
    ok: true,
    url: parsed.toString(),
    hostname,
    isHttps: parsed.protocol === "https:",
  };
}

/**
 * The same judgement applied to a RESOLVED IP address.
 *
 * Used by the fetcher after DNS resolution and after every redirect, because a public
 * hostname may resolve to a private address — deliberately, in a DNS-rebinding attack,
 * or by accident in a split-horizon network.
 */
export function isPermittedAddress(address: string): boolean {
  const host = address.trim().toLowerCase();
  if (host === "") return false;
  if (LOOPBACK_HOSTS.has(host)) return false;
  if (METADATA_HOSTS.has(host)) return false;
  if (isPrivateIpv4(host)) return false;
  if (isPrivateIpv6(host)) return false;
  return true;
}
