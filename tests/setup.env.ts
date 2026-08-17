import { config as loadEnv } from "dotenv";

// Load local env so DB integration tests pick up DATABASE_URL when it is set.
// Prisma 7 does not auto-load .env; vitest does not either — this bridges both.
// When DATABASE_URL is absent, integration suites self-skip (reported BLOCKED).
loadEnv({ path: ".env.local" });
