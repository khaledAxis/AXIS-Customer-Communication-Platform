import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ProviderEventType } from "../../src/domain/delivery/providerEvent";
import { getPrisma } from "../../src/server/db/prisma";
import {
  setProductionEmailProviderForTesting,
} from "../../src/server/integrations/email";
import type { ProviderSendResult } from "../../src/server/integrations/email/emailProvider";
import type {
  ProductionEmailProvider,
  ProductionProviderStatus,
  WebhookVerification,
} from "../../src/server/integrations/email/productionEmailProvider";
import { ingestProviderEvent } from "../../src/server/services/providerEventService";
import { GET, POST } from "../../src/app/api/webhooks/resend/route";

/**
 * The public provider-webhook endpoint (ADR-0025).
 *
 * The endpoint is reachable by anyone on the internet, so the questions these tests
 * ask are hostile ones: can an unsigned request suppress a customer? Can a rejection
 * be used to learn whether an address exists? Can a replayed event apply twice?
 *
 * `verifyWebhook` is stubbed through the port so no real signature scheme, secret or
 * network is involved — the route's ORDER of operations is what is under test.
 */

const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 16);
const address = (suffix: string) => `${RUN}.${suffix}@webhook.invalid`;

/** A provider stub whose verification answer is set per test. */
class StubProvider implements ProductionEmailProvider {
  readonly name = "RESEND" as const;
  verifyCalls = 0;

  constructor(private readonly answer: WebhookVerification) {}

  checkConfiguration(): ProductionProviderStatus {
    return {
      configured: true,
      enabled: false,
      name: this.name,
      problems: [],
      senderEmail: "newsletter@axis-gps.com",
      domain: {
        domain: "axis-gps.com",
        spf: "VERIFIED",
        dkim: "VERIFIED",
        dmarc: "UNKNOWN",
        requiredDnsRecords: [],
      },
    };
  }

  async send(): Promise<ProviderSendResult> {
    throw new Error("A webhook test must never submit a message.");
  }

  verifyWebhook(): WebhookVerification {
    this.verifyCalls += 1;
    return this.answer;
  }
}

const post = (body: unknown) =>
  POST(
    new Request("https://axis.internal/api/webhooks/resend", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

d("provider webhook endpoint", () => {
  let prisma: ReturnType<typeof getPrisma>;
  const touched: string[] = [];

  beforeAll(async () => {
    prisma = getPrisma();
    await prisma.$connect();
  });

  afterEach(() => {
    setProductionEmailProviderForTesting(undefined);
  });

  afterAll(async () => {
    setProductionEmailProviderForTesting(undefined);
    try {
      await prisma.suppressionEvent.deleteMany({
        where: { normalizedEmail: { in: touched } },
      });
      await prisma.suppression.deleteMany({
        where: { normalizedEmail: { in: touched } },
      });
      await prisma.unsubscribe.deleteMany({
        where: { normalizedEmail: { in: touched } },
      });
      await prisma.auditLog.deleteMany({
        where: { action: "PROVIDER_EVENT_INGESTED", entityId: null },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("refuses an unsigned request with 401 and changes nothing", async () => {
    const victim = address("unsigned");
    touched.push(victim);

    setProductionEmailProviderForTesting(
      new StubProvider({
        ok: false,
        reason: "UNSIGNED",
        message: "The webhook signature could not be verified.",
      }),
    );

    const response = await post({
      type: "email.bounced",
      data: { to: [victim], bounce: { type: "Permanent" } },
    });

    expect(response.status).toBe(401);
    // The whole point: a forged bounce must not suppress anybody.
    expect(await prisma.suppression.count({ where: { normalizedEmail: victim } })).toBe(0);
    expect(
      await prisma.suppressionEvent.count({ where: { normalizedEmail: victim } }),
    ).toBe(0);
  });

  it("says nothing about the recipient in a rejection", async () => {
    const victim = address("silent");
    setProductionEmailProviderForTesting(
      new StubProvider({ ok: false, reason: "UNSIGNED", message: "nope" }),
    );

    const response = await post({ type: "email.bounced", data: { to: [victim] } });
    const body = await response.text();

    // A probe learns only that it was refused — not whether the address is known.
    expect(body).not.toContain(victim);
    expect(body).not.toMatch(/@/);
  });

  it("verifies BEFORE reading the body — an unparseable payload is still refused", async () => {
    const stub = new StubProvider({ ok: false, reason: "UNSIGNED", message: "nope" });
    setProductionEmailProviderForTesting(stub);

    const response = await POST(
      new Request("https://axis.internal/api/webhooks/resend", {
        method: "POST",
        body: "this is not json at all",
      }),
    );

    expect(stub.verifyCalls).toBe(1);
    expect(response.status).toBe(401);
  });

  it("applies a verified hard bounce: suppressed and marked invalid", async () => {
    const bouncer = address("hardbounce");
    touched.push(bouncer);

    setProductionEmailProviderForTesting(
      new StubProvider({
        ok: true,
        events: [
          {
            providerEventId: `evt_${RUN}_hb`,
            type: ProviderEventType.HARD_BOUNCE,
            normalizedEmail: bouncer,
            providerMessageId: null,
            occurredAt: new Date(),
            reason: "Permanent / NoEmail",
          },
        ],
      }),
    );

    const response = await post({ type: "email.bounced" });
    expect(response.status).toBe(200);

    const suppression = await prisma.suppression.findFirst({
      where: { normalizedEmail: bouncer },
    });
    expect(suppression?.reason).toBe("HARD_BOUNCE");
  });

  it("records a replayed event once (200 both times, one suppression)", async () => {
    const repeater = address("replay");
    touched.push(repeater);

    const event = {
      providerEventId: `evt_${RUN}_replay`,
      type: ProviderEventType.COMPLAINT,
      normalizedEmail: repeater,
      providerMessageId: null,
      occurredAt: new Date(),
      reason: null,
    };
    setProductionEmailProviderForTesting(
      new StubProvider({ ok: true, events: [event] }),
    );

    const first = await post({ type: "email.complained" });
    const second = await post({ type: "email.complained" });

    // 200 both times: anything else makes the provider retry forever.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(
      await prisma.suppressionEvent.count({ where: { normalizedEmail: repeater } }),
    ).toBe(1);
  });

  it("a complaint suppresses without marking the mailbox invalid", async () => {
    const complainer = address("complaint");
    touched.push(complainer);

    const outcome = await ingestProviderEvent({
      providerEventId: `evt_${RUN}_complaint`,
      type: ProviderEventType.COMPLAINT,
      normalizedEmail: complainer,
      occurredAt: new Date(),
    });

    expect(outcome.ok).toBe(true);
    const effects = outcome.ok ? outcome.effects.join(" ") : "";
    expect(effects).toMatch(/suppressed/);
    // The person has a working mailbox; they simply do not want AXIS in it.
    expect(effects).not.toMatch(/marked invalid/);
  });

  it("refuses GET, so the endpoint cannot be probed from a browser", async () => {
    const response = await GET();
    expect(response.status).toBe(405);
  });

  it("the route reads the RAW body — never request.json()", () => {
    // Re-serialising the body would change the bytes the signature covers.
    const source = readFileSync(
      new URL("../../src/app/api/webhooks/resend/route.ts", import.meta.url),
      "utf8",
    )
      // Comments name `request.json()` to explain why it is not used.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(source).toMatch(/request\.text\(\)/);
    expect(source).not.toMatch(/request\.json\(\)/);
  });
});
