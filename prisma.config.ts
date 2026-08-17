import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads .env and no longer reads `url` from schema.prisma.
// Load local env (git-ignored) so `prisma migrate` can find DATABASE_URL.
loadEnv({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  // Required only for migration/introspection commands. Empty string when unset
  // so `prisma validate` / `generate` (which do not connect) still work; a real
  // PostgreSQL DATABASE_URL must be provided in .env.local before running migrations.
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
