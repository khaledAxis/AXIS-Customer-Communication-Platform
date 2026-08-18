/**
 * Strict "is this URL reachable by an outside recipient over HTTPS" test.
 *
 * Stricter than `isDeliverableImageUrl`, which only rules out loopback hosts. This
 * additionally requires HTTPS and rejects private / link-local / internal hostnames,
 * which are reachable from this machine but never from a customer's mail client.
 *
 * Pure: no I/O. It validates the SHAPE of a URL; it cannot know whether the asset
 * actually exists (see the alt-text fallback in the newsletter template).
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/** RFC1918 private space, link-local, and carrier-grade NAT. */
function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".");
  if (octets.length !== 4) return false;

  const numbers = octets.map((part) => Number(part));
  if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  const [a, b] = numbers;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/** Hostnames that only resolve inside a network. */
function isInternalHostname(hostname: string): boolean {
  return (
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localdomain") ||
    hostname.endsWith(".home.arpa") ||
    !hostname.includes(".") // bare host such as "intranet"
  );
}

export function isPublicHttpsUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed === "") return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  // HTTPS only — an http:// asset is both insecure and often blocked in mail clients.
  if (parsed.protocol !== "https:") return false;

  const hostname = parsed.hostname.toLowerCase();
  if (LOOPBACK.has(hostname)) return false;
  if (isPrivateIpv4(hostname)) return false;
  if (hostname.startsWith("[")) return false; // raw IPv6 literal — not a public asset host
  if (isInternalHostname(hostname)) return false;

  return true;
}
