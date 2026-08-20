// Mints a FIXTURE unsubscribe link for a SYNTHETIC address, so the public
// unsubscribe flow can be walked in a browser without touching a customer.
//
//   node scripts/mint-unsubscribe-fixture.mjs
//
// Safety, enforced rather than assumed:
//   * the address is fixed and ends in `.test`, a reserved TLD that can never be a
//     real mailbox;
//   * the script REFUSES to run if that address appears anywhere in the mirrored CRM;
//   * the token is marked `purpose: FIXTURE`, so it is distinguishable from any link
//     that was really sent to a person.
//
// It writes one CommunicationAddress and one UnsubscribeToken. It sends nothing, and
// it never reads or modifies a real customer record.

import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const FIXTURE_EMAIL = "browser-fixture@axis-unsubscribe-demo.test";

function loadEnvLocal() {
  const env = {};
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const at = trimmed.indexOf("=");
      if (at === -1) continue;
      const key = trimmed.slice(0, at).trim();
      let value = trimmed.slice(at + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    // No .env.local — fall through to the process environment.
  }
  return env;
}

const env = { ...loadEnvLocal(), ...process.env };
if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is not configured.");
  process.exit(1);
}

const { PrismaClient } = await import("@prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

try {
  if (!FIXTURE_EMAIL.endsWith(".test")) {
    throw new Error("The fixture address must use the reserved .test TLD.");
  }

  // Refuse outright if anything in the mirrored CRM uses this address.
  const [asCompany, asContact] = await Promise.all([
    prisma.company.count({ where: { companyEmailNorm: FIXTURE_EMAIL } }),
    prisma.contact.count({ where: { emailNorm: FIXTURE_EMAIL } }),
  ]);
  if (asCompany + asContact > 0) {
    throw new Error(
      "That address exists in the CRM. This script only ever creates synthetic ones.",
    );
  }

  // Start clean, so the confirmation page is reachable rather than "already done".
  await prisma.unsubscribe.deleteMany({ where: { normalizedEmail: FIXTURE_EMAIL } });
  await prisma.unsubscribeToken.deleteMany({
    where: { normalizedEmail: FIXTURE_EMAIL },
  });

  const address = await prisma.communicationAddress.upsert({
    where: { normalizedEmail: FIXTURE_EMAIL },
    create: { normalizedEmail: FIXTURE_EMAIL, language: "HE" },
    update: {},
    select: { id: true },
  });

  // Same shape as a production token: 32 CSPRNG bytes, base64url, hash-only storage.
  const token = randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");

  await prisma.unsubscribeToken.create({
    data: {
      tokenHash,
      normalizedEmail: FIXTURE_EMAIL,
      communicationAddressId: address.id,
      purpose: "FIXTURE",
    },
  });

  const origin = (env.PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  console.log("");
  console.log("Fixture address :", FIXTURE_EMAIL, "(synthetic — not a customer)");
  console.log("Unsubscribe URL :", `${origin}/unsubscribe/${token}`);
  console.log("");
  console.log("Open it, confirm, reload to see the idempotent result, then run");
  console.log("  node scripts/mint-unsubscribe-fixture.mjs --clean");
  console.log("to remove the fixture again.");
} finally {
  await prisma.$disconnect();
}

if (process.argv.includes("--clean")) {
  const cleanup = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  try {
    await cleanup.unsubscribe.deleteMany({ where: { normalizedEmail: FIXTURE_EMAIL } });
    await cleanup.unsubscribeToken.deleteMany({
      where: { normalizedEmail: FIXTURE_EMAIL },
    });
    await cleanup.communicationAddress.deleteMany({
      where: { normalizedEmail: FIXTURE_EMAIL },
    });
    console.log("Fixture removed.");
  } finally {
    await cleanup.$disconnect();
  }
}
