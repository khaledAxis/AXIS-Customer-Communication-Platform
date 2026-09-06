import { spawn } from "node:child_process";
import { loadSecretFiles, validateHostedConfig } from "./runtime-config.mjs";

try {
  loadSecretFiles(process.env);
  const errors = validateHostedConfig(process.env);
  if (errors.length) throw new Error(errors.join(" "));
  process.env.AXIS_HOSTED = "true";
  process.env.PRODUCTION_DELIVERY_ENABLED ??= "false";
  process.env.PROVIDER_PILOT_ENABLED = "false";
  process.env.QA_EMAIL_ENABLED = "false";
  process.env.SEND_MODE ??= "TEST";
  process.env.AUTH_TRUST_HOST = "true";
  const child = spawn(process.execPath, ["server.js"], { stdio: "inherit", env: process.env });
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
  child.once("error", () => { console.error('{"event":"startup_failed"}'); process.exitCode = 1; });
  child.once("exit", code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(JSON.stringify({ event: "configuration_refused", message: error.message }));
  process.exitCode = 1;
}
