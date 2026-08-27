import { execFileSync } from "node:child_process";

/**
 * Re-seeds `axis_ccp_test` before every run (ADR-0031).
 *
 * The specs deliberately MUTATE fixtures — they approve articles, pause sources,
 * create automations. Without a reset, a second run starts from the first run's end
 * state and assertions drift, which shows up as tests that "sometimes fail". A suite
 * whose result depends on how many times it has been run cannot be trusted to report
 * a regression.
 */
export default function globalSetup(): void {
  execFileSync(process.execPath, ["e2e/preflight.mjs"], { stdio: "inherit" });
  execFileSync(process.execPath, ["e2e/seed.mjs"], { stdio: "inherit" });
}
