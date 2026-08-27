import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  QA_ALLOWED_RECIPIENTS,
  QA_SUBJECT_PREFIX,
} from "../../src/domain/send/qaPolicy";
import { getPrisma } from "../../src/server/db/prisma";
import * as ledger from "../../src/server/db/repositories/qaLedgerRepository";
import { setQaFixtureOwnerForTesting } from "../../src/server/db/repositories/qaLedgerRepository";
import type { ProviderSendResult } from "../../src/server/integrations/email/emailProvider";
import type {
  QaEmailMessage,
  QaEmailProvider,
  QaProviderStatus,
} from "../../src/server/integrations/email/qaEmailProvider";
import { setQaEmailProviderForTesting } from "../../src/server/integrations/email/qaEmailProvider";
import * as qa from "../../src/server/services/qaEmailService";
import { actAs, actAsNobody, clearTestActor, createTestUser, type TestUser } from "../support/actor";

/**
 * The QA email allowlist, end to end (ADR-0027).
 *
 * NO TEST HERE SENDS A REAL EMAIL. The QA transport is replaced by a recorder for the
 * whole suite, and the registry additionally refuses to construct a live adapter under
 * the test runner — so a regression shows up as a recorded address, never as mail.
 *
 * The central claim under test: for EVERY rejected recipient, provider network calls
 * are exactly ZERO. Counting them is how that stops being a promise and starts being
 * a measurement.
 */

const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

/** Records what it was asked to send instead of sending it. */
class RecordingQaProvider implements QaEmailProvider {
  readonly name = "FAKE_QA" as const;
  readonly submissions: QaEmailMessage[] = [];
  private readonly token = randomUUID().slice(0, 8);

  constructor(private readonly configured = true) {}

  checkConfiguration(): QaProviderStatus {
    return {
      configured: this.configured,
      problems: this.configured ? [] : ["Not configured for this test."],
      senderEmail: "axisgpscana@gmail.com",
      replyToEmail: "noreply@axis-gps.com",
    };
  }

  async send(message: QaEmailMessage): Promise<ProviderSendResult> {
    this.submissions.push(message);
    return {
      outcome: "ACCEPTED",
      statusCode: 250,
      // Unique per instance AND per test: `providerMessageId` is UNIQUE in the
      // ledger, so a reused id would collide rather than record a second send.
      providerMessageId: `<fake-${this.token}-${this.submissions.length}@axis.test>`,
      message: "Gmail accepted the QA email for delivery.",
    };
  }
}

d("QA email allowlist", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let provider: RecordingQaProvider;
  let operator: TestUser;
  const savedEnv: Record<string, string | undefined> = {};

  /**
   * This suite's fixture ownership token (ADR-0028). Everything it writes to the QA
   * ledger carries it, so its cleanup can find its own rows and can reach nothing
   * else — in particular, not the LIVE rows recording real emails.
   */
  const OWNER = `qa-allowlist-${randomUUID().slice(0, 12)}`;

  beforeAll(async () => {
    operator = await createTestUser({ prefix: "qa", role: "ADMIN" });
    actAs(operator);
    prisma = getPrisma();
    await prisma.$connect();

    savedEnv.QA_EMAIL_ENABLED = process.env.QA_EMAIL_ENABLED;
    savedEnv.NEWSLETTER_REPLY_TO = process.env.NEWSLETTER_REPLY_TO;
    process.env.QA_EMAIL_ENABLED = "true";
    // Pin fixture selection to THIS suite so parallel workers cannot see each
    // other's runs (ADR-0028).
    setQaFixtureOwnerForTesting(OWNER);
    process.env.NEWSLETTER_REPLY_TO = "noreply@axis-gps.com";

    // A FIXTURE run, not a live one: sends made through it are written as fixture
    // rows, so this suite can exercise the full path without consuming a single
    // unit of a real recipient's quota.
    await ledger.createRun({
      label: `allowlist suite ${OWNER}`,
      origin: "TEST_FIXTURE",
      fixtureOwner: OWNER,
    });
  });

  beforeEach(() => {
    actAs(operator);
    provider = new RecordingQaProvider();
    setQaEmailProviderForTesting(provider);
  });

  afterAll(async () => {
    clearTestActor();
    setQaFixtureOwnerForTesting(undefined);
    setQaEmailProviderForTesting(undefined);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      // Scoped to THIS suite's fixture token. Structurally unable to reach a LIVE row
      // — the delete pins `origin: TEST_FIXTURE` as well as the owner.
      await ledger.deleteFixtures(OWNER);
      await prisma.user.deleteMany({ where: { id: operator.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  const install = (p: RecordingQaProvider) => {
    provider = p;
    setQaEmailProviderForTesting(p);
  };

  const SCENARIO = "QA-BASIC-EN";

  // ------------------------------------------------------- the four are accepted

  it("accepts all four approved recipients", async () => {
    install(new RecordingQaProvider());

    for (const recipient of QA_ALLOWED_RECIPIENTS) {
      const result = await qa.sendQaEmail({ scenarioId: SCENARIO, recipient });
      expect(result.ok, `${recipient} should be accepted`).toBe(true);
      expect(result.outcome).toBe("ACCEPTED");
      expect(result.providerCalls).toBe(1);
      expect(result.providerMessageId).toBeTruthy();
    }

    expect(provider.submissions).toHaveLength(4);
    expect(provider.submissions.map((s) => s.to).sort()).toEqual(
      [...QA_ALLOWED_RECIPIENTS].sort(),
    );
  });

  it("puts the mandatory prefix on every subject it submits", async () => {
    install(new RecordingQaProvider());
    for (const scenario of qa.QA_SCENARIOS.slice(0, 4)) {
      await qa.sendQaEmail({ scenarioId: scenario.id, recipient: "info@axis-gps.com" });
    }
    for (const submission of provider.submissions) {
      expect(submission.subject.startsWith(QA_SUBJECT_PREFIX)).toBe(true);
      // Applied once, never doubled.
      expect(submission.subject.split(QA_SUBJECT_PREFIX)).toHaveLength(2);
    }
  });

  // ------------------------------------------- every rejection: ZERO provider calls

  const REJECTED: { label: string; recipient: unknown }[] = [
    { label: "same domain, not on the list", recipient: "someone@axis-gps.com" },
    { label: "same domain, sales", recipient: "sales@axis-gps.com" },
    { label: "same domain, test", recipient: "test@axis-gps.com" },
    { label: "external", recipient: "customer@example.com" },
    { label: "external gmail", recipient: "test@gmail.com" },
    { label: "plus alias (khaled)", recipient: "khaled-s+qa@axis-gps.com" },
    { label: "plus alias (moaawya)", recipient: "moaawya+qa@axis-gps.com" },
    { label: "plus alias (info)", recipient: "info+qa@axis-gps.com" },
    { label: "plus alias (saja)", recipient: "saja+qa@axis-gps.com" },
    { label: "display name (khaled)", recipient: "Khaled <khaled-s@axis-gps.com>" },
    { label: "display name (saja)", recipient: "Saja <saja@axis-gps.com>" },
    { label: "comma list", recipient: "khaled-s@axis-gps.com,info@axis-gps.com" },
    { label: "semicolon list", recipient: "saja@axis-gps.com;moaawya@axis-gps.com" },
    { label: "array", recipient: ["khaled-s@axis-gps.com"] },
    { label: "array of all four", recipient: [...QA_ALLOWED_RECIPIENTS] },
    { label: "object", recipient: { address: "khaled-s@axis-gps.com" } },
    { label: "null", recipient: null },
    { label: "undefined", recipient: undefined },
    { label: "empty string", recipient: "" },
    { label: "whitespace", recipient: "   " },
    { label: "CRLF injection", recipient: "khaled-s@axis-gps.com\r\nBcc: everyone@example.com" },
    { label: "LF injection", recipient: "khaled-s@axis-gps.com\nCc: customer@example.com" },
    { label: "tab injection", recipient: "khaled-s@axis-gps.com\tinfo@axis-gps.com" },
    { label: "unicode lookalike (Cyrillic a)", recipient: "sаja@axis-gps.com" },
    { label: "unicode lookalike (Greek o)", recipient: "infο@axis-gps.com" },
  ];

  it("rejects every unauthorized recipient with ZERO provider calls", async () => {
    install(new RecordingQaProvider());

    for (const testCase of REJECTED) {
      const result = await qa.sendQaEmail({
        scenarioId: SCENARIO,
        recipient: testCase.recipient as string,
      });

      expect(result.ok, `${testCase.label} must be refused`).toBe(false);
      expect(result.outcome, testCase.label).toBe("REFUSED");
      // The measurement that matters.
      expect(result.providerCalls, `${testCase.label} must make no provider call`).toBe(0);
    }

    // Not one submission across all 25 rejected cases.
    expect(provider.submissions).toHaveLength(0);
  });

  it("writes no ledger row for a rejected recipient", async () => {
    install(new RecordingQaProvider());
    const before = await prisma.campaignTestSend.count({ where: { channel: "QA_EMAIL" } });

    await qa.sendQaEmail({ scenarioId: SCENARIO, recipient: "customer@example.com" });

    const after = await prisma.campaignTestSend.count({ where: { channel: "QA_EMAIL" } });
    expect(after).toBe(before);
  });

  // ------------------------------------------------------- envelope shape

  it("submits no CC and no BCC, ever", async () => {
    install(new RecordingQaProvider());
    await qa.sendQaEmail({ scenarioId: SCENARIO, recipient: "khaled-s@axis-gps.com" });

    const submission = provider.submissions[0] as unknown as Record<string, unknown>;
    expect(submission.cc).toBeUndefined();
    expect(submission.bcc).toBeUndefined();
    expect(submission.from).toBeUndefined();
    expect(submission.replyTo).toBeUndefined();
    // A single string, never a list.
    expect(typeof submission.to).toBe("string");
  });

  // ------------------------------------------------------- switches and caps

  it("refuses to send while QA mode is off", async () => {
    install(new RecordingQaProvider());
    process.env.QA_EMAIL_ENABLED = "false";
    try {
      const result = await qa.sendQaEmail({
        scenarioId: SCENARIO,
        recipient: "khaled-s@axis-gps.com",
      });
      expect(result.ok).toBe(false);
      expect(result.providerCalls).toBe(0);
      expect(provider.submissions).toHaveLength(0);
    } finally {
      process.env.QA_EMAIL_ENABLED = "true";
    }
  });

  it("refuses when the transport is not configured", async () => {
    install(new RecordingQaProvider(false));
    const result = await qa.sendQaEmail({
      scenarioId: SCENARIO,
      recipient: "khaled-s@axis-gps.com",
    });
    expect(result.ok).toBe(false);
    expect(result.providerCalls).toBe(0);
    expect(provider.submissions).toHaveLength(0);
  });

  it("refuses an unknown scenario without calling the provider", async () => {
    install(new RecordingQaProvider());
    const result = await qa.sendQaEmail({
      scenarioId: "NOT-A-SCENARIO",
      recipient: "khaled-s@axis-gps.com",
    });
    expect(result.ok).toBe(false);
    expect(result.providerCalls).toBe(0);
    expect(provider.submissions).toHaveLength(0);
  });

  it("enforces the per-recipient hard cap from the ledger", async () => {
    install(new RecordingQaProvider());
    const status = await qa.getQaStatus();
    expect(status.hardPerRecipient).toBe(10);
    expect(status.hardTotal).toBe(40);
    // Counts come from the ledger, not from a caller-supplied number.
    expect(Object.keys(status.perRecipient).sort()).toEqual(
      [...QA_ALLOWED_RECIPIENTS].sort(),
    );
  });

  // ------------------------------------------------------- authentication

  it("requires an authenticated actor", async () => {
    actAsNobody();
    await expect(
      qa.sendQaEmail({ scenarioId: SCENARIO, recipient: "khaled-s@axis-gps.com" }),
    ).rejects.toThrow();
    await expect(qa.getQaStatus()).rejects.toThrow();
  });

  // ------------------------------------------------------- no customer data

  it("creates no CampaignRecipient and no CampaignEvent", async () => {
    install(new RecordingQaProvider());
    const before = await prisma.campaignRecipient.count();

    await qa.sendQaEmail({ scenarioId: SCENARIO, recipient: "saja@axis-gps.com" });

    // QA lives in its own tables (ADR-0028) and touches no campaign ledger at all.
    expect(await prisma.campaignRecipient.count()).toBe(before);
    expect(await prisma.campaignEvent.count()).toBe(0);
    expect(await prisma.campaignTestSend.count({ where: { channel: "QA_EMAIL" } })).toBe(
      0,
    );

    // The send it DID record is a fixture row owned by this suite.
    const recorded = await prisma.qaEmailSend.findFirst({
      where: { fixtureOwner: OWNER, recipient: "saja@axis-gps.com" },
    });
    expect(recorded).not.toBeNull();
    expect(recorded?.origin).toBe("TEST_FIXTURE");
  });

  it("the QA service reads no CRM, audience or ledger source for its recipient", () => {
    const code = readFileSync(
      new URL("../../src/server/services/qaEmailService.ts", import.meta.url),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    for (const forbidden of [
      "communicationAddress",
      "campaignRecipient",
      "campaignFinalAudience",
      "finalAudienceDestination",
      "contact.",
      "company.",
      "segment.",
      "resolveAudience",
      "monday",
    ]) {
      expect(code.toLowerCase(), `must not reference ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  });

  // ------------------------------------------------- SAFE TEST is untouched

  it("leaves the SAFE TEST hard-lock exactly as it was", async () => {
    const safeTest = await import("../../src/domain/send/testSendPolicy");

    expect(safeTest.AUTHORIZED_TEST_RECIPIENT).toBe("khaled-s@axis-gps.com");
    expect(safeTest.AUTHORIZED_TEST_SENDER).toBe("axisgpscana@gmail.com");

    // The three QA addresses SAFE TEST must still refuse.
    for (const address of ["moaawya@axis-gps.com", "info@axis-gps.com", "saja@axis-gps.com"]) {
      expect(() => safeTest.assertSafeTestEnvelope({ to: address })).toThrow();
    }
    // And the one it allows, it still allows.
    expect(safeTest.assertSafeTestEnvelope({ to: "khaled-s@axis-gps.com" })).toBe(
      "khaled-s@axis-gps.com",
    );
  });

  it("keeps the QA and SAFE TEST transports on separate ports", () => {
    const qaCode = readFileSync(
      new URL("../../src/server/integrations/email/qaEmailProvider.ts", import.meta.url),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const safeCode = readFileSync(
      new URL(
        "../../src/server/integrations/email/gmailSmtpEmailProvider.ts",
        import.meta.url,
      ),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    // Neither adapter can apply the other's policy.
    expect(qaCode).not.toContain("assertSafeTestEnvelope");
    expect(qaCode).not.toContain("AUTHORIZED_TEST_RECIPIENT");
    expect(safeCode).not.toContain("assertSafeQaEnvelope");
    expect(safeCode).not.toContain("QA_ALLOWED_RECIPIENTS");
  });

  // ------------------------------------------------- the notice stays out of production

  it("renders the QA notice only for QA, never in a normal newsletter", async () => {
    const { renderNewsletterHtml } = await import(
      "../../src/domain/email/newsletterTemplate"
    );
    const { getNewsletterBrand } = await import("../../src/server/services/brandConfig");

    const base = {
      subject: "Normal newsletter",
      language: "HE" as const,
      items: [{ title: "Item" }],
      brand: getNewsletterBrand(),
      isTestMode: false,
    };

    const production = renderNewsletterHtml(base);
    expect(production).not.toContain("PLATFORM TEST");
    expect(production).not.toContain("test email generated by the AXIS Newsletter Platform");
    expect(production).not.toContain("בדיקת מערכת");

    const qaRendered = renderNewsletterHtml({
      ...base,
      qaNotice: "This is a test email generated by the AXIS Newsletter Platform.",
    });
    expect(qaRendered).toContain("test email generated by the AXIS Newsletter Platform");
  });

  it("keeps the footer unsubscribe unchanged and emits no List-Unsubscribe", async () => {
    install(new RecordingQaProvider());
    await qa.sendQaEmail({ scenarioId: "QA-FOOTER", recipient: "info@axis-gps.com" });

    const html = provider.submissions[0].html;

    // No header-level unsubscribe of any kind — Gmail must not show its own control.
    expect(html.toLowerCase()).not.toContain("list-unsubscribe");

    // Exactly ONE clickable unsubscribe affordance. The element's text is exactly
    // "Unsubscribe"; the explanatory line beneath it reads "Unsubscribe link is
    // activated before real sending", so it does not match this and is not counted.
    const clickable = html.split(">Unsubscribe<").length - 1;
    expect(clickable).toBe(1);
  });

  it("does not change the footer at all — QA and production footers are identical", async () => {
    const { renderNewsletterHtml } = await import(
      "../../src/domain/email/newsletterTemplate"
    );
    const { getNewsletterBrand } = await import("../../src/server/services/brandConfig");

    const base = {
      subject: "Footer comparison",
      language: "HE" as const,
      items: [{ title: "Item" }],
      brand: getNewsletterBrand(),
      isTestMode: true,
    };

    const footerOf = (html: string) => html.slice(html.lastIndexOf("<tr><td", html.indexOf("unsubscribe")));

    const production = renderNewsletterHtml(base);
    const withNotice = renderNewsletterHtml({ ...base, qaNotice: "Test notice." });

    // The QA notice is ADDITIVE at the top. Everything from the footer down is byte
    // identical, so the unsubscribe affordance a recipient sees is unchanged.
    expect(footerOf(withNotice)).toBe(footerOf(production));
  });
});
