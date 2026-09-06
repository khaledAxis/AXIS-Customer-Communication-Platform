import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { loadSecretFiles } from "./runtime-config.mjs";

export function workerConfiguration(env) {
  const url = new URL(env.SCHEDULER_URL || "http://127.0.0.1:3000/api/internal/jobs/tick");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/api/internal/jobs/tick") throw new Error("SCHEDULER_URL must be the exact credential-free job tick endpoint.");
  // Plain HTTP is permitted only for the private compose service or loopback.
  if (url.protocol === "http:" && !["app", "localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Remote scheduler connections require HTTPS.");
  const secret = env.SCHEDULER_TRIGGER_SECRET;
  if (!secret || secret.length < 32 || /[\r\n]/.test(secret)) throw new Error("A scheduler trigger secret of at least 32 characters is required.");
  return { url: url.href, secret };
}

export async function tick(config, fetcher = fetch, signal) {
  const response = await fetcher(config.url, { method: "POST", redirect: "error",
    headers: { Authorization: `Bearer ${config.secret}` }, signal: signal ?? AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error("Scheduler tick refused or unavailable.");
  const result = await response.json();
  if (!["idle", "processed", "disabled"].includes(result.status)) throw new Error("Invalid scheduler response.");
  return result.status;
}

async function main() {
  const config = workerConfiguration(loadSecretFiles(process.env));
  const controller = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => controller.abort());
  let failures = 0;
  while (!controller.signal.aborted) {
    try {
      const status = await tick(config, fetch, AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]));
      if (failures || status === "processed") console.log(JSON.stringify({ event: "scheduler_tick", status }));
      failures = 0;
    } catch {
      if (controller.signal.aborted) break;
      failures++;
      console.error(JSON.stringify({ event: "scheduler_tick_failed", consecutiveFailures: failures }));
    }
    await delay(failures ? Math.min(60000, 5000 * 2 ** Math.min(failures, 4)) : 5000, undefined,
      { signal: controller.signal }).catch(() => undefined);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('{"event":"scheduler_configuration_refused"}'); process.exitCode = 1; });
}
