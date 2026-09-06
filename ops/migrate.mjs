import { spawnSync } from "node:child_process";
import { loadSecretFiles } from "./runtime-config.mjs";
try {
  loadSecretFiles(process.env);
  const url = new URL(process.env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname === "/")
    throw new Error();
  const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: process.env, stdio: "inherit", timeout: 300000,
  });
  process.exitCode = result.status === 0 ? 0 : 1;
} catch {
  console.error('{"event":"migration_configuration_invalid"}');
  process.exitCode = 1;
}

