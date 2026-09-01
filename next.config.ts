import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `@node-rs/argon2` ships a native `.node` binary for password hashing (ADR-0023).
   * Bundling it would break the binary lookup, so it is loaded through Node's own
   * `require` instead. It is server-only by construction.
   */
  serverExternalPackages: ["@node-rs/argon2"],
  allowedDevOrigins: ["192.168.2.36"],
  // The Electron build packages this traced server outside app.asar and launches
  // its generated server.js with Electron's isolated Node utility process.
  output: "standalone",
};

export default nextConfig;
