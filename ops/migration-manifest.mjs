import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const manifest = readdirSync(resolve(root, "prisma/migrations"))
  .filter(name => /^\d{14}_/.test(name)).sort().map(name => ({
    name,
    checksum: createHash("sha256").update(readFileSync(resolve(root, "prisma/migrations", name, "migration.sql"), "utf8").replace(/\r\n/g, "\n")).digest("hex"),
    windowsChecksum: createHash("sha256").update(readFileSync(resolve(root, "prisma/migrations", name, "migration.sql"), "utf8").replace(/\r?\n/g, "\r\n")).digest("hex"),
  }));
const file = resolve(root, "src/server/db/migration-manifest.json");
const output = JSON.stringify(manifest, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8").replace(/\r\n/g, "\n") !== output)
    throw new Error("Migration manifest is stale. Run npm run ops:manifest.");
} else writeFileSync(file, output);
