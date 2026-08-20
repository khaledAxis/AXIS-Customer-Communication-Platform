import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `@node-rs/argon2` ships a native `.node` binary for password hashing (ADR-0023).
   * Bundling it would break the binary lookup, so it is loaded through Node's own
   * `require` instead. It is server-only by construction — nothing in `ui/` or a
   * client component may import it.
   */
  serverExternalPackages: ["@node-rs/argon2"],
};

export default nextConfig;
