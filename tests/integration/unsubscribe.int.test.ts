import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Role } from "../../src/domain/auth/authorization";
import {
  renderNewsletterHtml,
  renderNewsletterText,
} from "../../src/domain/email/newsletterTemplate";
import { Operator } from "../../src/domain/segment/segmentFields";
import {
  TEST_UNSUBSCRIBE_TOKEN,
  mintUnsubscribeToken,
} from "../../src/domain/unsubscribe/unsubscribeToken";
import { ConsentSource, ConsentStatus, Language } from "../../src/domain/types";
import { resetUnsubscribeProbes } from "../../src/server/auth/rateLimit";
import { getPrisma } from "../../src/server/db/prisma";
import { setCampaignSegment } from "../../src/server/services/campaignAudienceService";
import { setConsent } from "../../src/server/services/communicationService";
import {
  addContent,
  createNewsletter,
  getNewsletter,
  buildNewsletterDocument,
} from "../../src/server/services/newsletterService";
import { createSegment } from "../../src/server/services/segmentService";
import { previewAudience } from "../../src/server/services/segmentService";
import {
  getSendReadiness,
  prepareFinalAudience,
  approveForProduction,
} from "../../src/server/services/sendReadinessService";
import {
  confirmUnsubscribe,
  issueUnsubscribeLink,
  lookupUnsubscribeToken,
} from "../../src/server/services/unsubscribeService";
import {
  actAs,
  clearTestActor,
  createTestUser,
  type TestUser,
} from "../support/actor";

/**
 * The public, no-login unsubscribe endpoint (ADR-0024).
 *
 * Everything here runs against synthetic, run-scoped addresses. No real customer row
 * is read or written, and nothing sends email.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const d = describe.skipIf(!HAS_DB);

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const BOARD = `unsub-co-${RUN}`;

const ADDRESS_A = `${RUN}-a@example.test`;
const ADDRESS_B = `${RUN}-b@example.test`;
const ADDRESS_C = `${RUN}-c@example.test`;
const ALL = [ADDRESS_A, ADDRESS_B, ADDRESS_C];

const ids = {
  users: [] as string[],
  companies: [] as string[],
  addresses: [] as string[],
  campaigns: [] as string[],
  segments: [] as string[],
  contentItems: [] as string[],
};

d("public unsubscribe", () => {
  let prisma: ReturnType<typeof getPrisma>;
  let staff: TestUser;
  let approver: TestUser;
  let campaignId = "";
  let segmentId = "";

  beforeAll(async () => {
    prisma = getPrisma();
    staff = await createTestUser({ prefix: `${RUN}-staff`, role: Role.MANAGER });
    approver = await createTestUser({ prefix: `${RUN}-appr`, role: Role.MANAGER });
    ids.users.push(staff.id, approver.id);
    actAs(staff);

    for (const [key, address] of [
      ["a", ADDRESS_A],
      ["b", ADDRESS_B],
      ["c", ADDRESS_C],
    ] as const) {
      const company = await prisma.company.create({
        data: {
          mondayBoardId: BOARD,
          mondayItemId: `${RUN}-${key}`,
          name: `${RUN} company ${key}`,
          customerStatus: "ACTIVE",
          companyEmail: address,
          companyEmailNorm: address,
          // Present on the record and structurally unreachable as a campaign target.
          accountingEmail: `${RUN}-${key}-accounting@example.test`,
        },
      });
      ids.companies.push(company.id);

      const row = await prisma.communicationAddress.create({
        data: { normalizedEmail: address, language: Language.HE },
      });
      ids.addresses.push(row.id);
    }

    const content = await prisma.contentItem.create({
      data: {
        title: `${RUN} article`,
        bodyHtml: "<p>Body</p>",
        language: Language.HE,
        origin: "INTERNAL",
        reviewState: "APPROVED",
      },
    });
    ids.contentItems.push(content.id);

    segmentId = await createSegment({
      name: `${RUN} audience`,
      definition: {
        version: 1,
        conditions: [
          { field: "company.name", operator: Operator.STARTS_WITH, value: RUN },
        ],
        groups: [],
        include: { companyEmails: true, contactEmails: false },
      },
    });
    ids.segments.push(segmentId);

    const created = await createNewsletter({
      name: `${RUN} newsletter`,
      subject: "עדכון לקוחות",
      language: Language.HE,
    });
    if (!created.ok) throw new Error("fixture campaign failed");
    campaignId = created.data.id;
    ids.campaigns.push(campaignId);
    await addContent(campaignId, content.id);
    await setCampaignSegment(campaignId, segmentId);
  });

  beforeEach(async () => {
    resetUnsubscribeProbes();
    actAs(staff);
    // Every test starts from "subscribed", so ordering cannot matter.
    await prisma.unsubscribe.deleteMany({ where: { normalizedEmail: { in: ALL } } });
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    clearTestActor();
    await prisma.campaignProductionApproval.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.campaignFinalAudience.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.campaignContentItem.deleteMany({
      where: { campaignId: { in: ids.campaigns } },
    });
    await prisma.unsubscribeToken.deleteMany({
      where: { normalizedEmail: { in: ALL } },
    });
    await prisma.unsubscribe.deleteMany({ where: { normalizedEmail: { in: ALL } } });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...ids.addresses, ...ids.campaigns] } },
    });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids.users } } });
    await prisma.campaign.deleteMany({ where: { id: { in: ids.campaigns } } });
    await prisma.contentItem.deleteMany({ where: { id: { in: ids.contentItems } } });
    await prisma.segment.deleteMany({ where: { id: { in: ids.segments } } });
    await prisma.company.deleteMany({ where: { id: { in: ids.companies } } });
    await prisma.communicationAddress.deleteMany({
      where: { id: { in: ids.addresses } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  });

  const linkFor = (address: string) =>
    issueUnsubscribeLink({ normalizedEmail: address, campaignId });

  // ---- 1..4 token resolution --------------------------------------------

  it("resolves a valid token to the address it was issued for", async () => {
    const { token } = await linkFor(ADDRESS_A);
    const lookup = await lookupUnsubscribeToken(token);
    expect(lookup.ok).toBe(true);
    expect(lookup.ok && lookup.normalizedEmail).toBe(ADDRESS_A);
  });

  it("rejects a modified token", async () => {
    const { token } = await linkFor(ADDRESS_A);
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    const lookup = await lookupUnsubscribeToken(tampered);
    expect(lookup.ok).toBe(false);
    // …and it certainly did not resolve to somebody else.
    expect(JSON.stringify(lookup)).not.toContain(ADDRESS_A);
  });

  it("rejects a random token", async () => {
    const lookup = await lookupUnsubscribeToken(mintUnsubscribeToken().token);
    expect(lookup.ok).toBe(false);
  });

  it("cannot use A's token to unsubscribe B", async () => {
    const { token } = await linkFor(ADDRESS_A);
    await confirmUnsubscribe(token);

    const unsubscribed = await prisma.unsubscribe.findMany({
      where: { normalizedEmail: { in: ALL } },
      select: { normalizedEmail: true },
    });
    expect(unsubscribed.map((row) => row.normalizedEmail)).toEqual([ADDRESS_A]);
  });

  // ---- 5..7 the confirmation flow ---------------------------------------

  it("does NOT unsubscribe on a GET", async () => {
    const { token } = await linkFor(ADDRESS_A);
    await lookupUnsubscribeToken(token);
    await lookupUnsubscribeToken(token);

    // Mail clients prefetch links and scanners open them. Resolving must be inert.
    expect(
      await prisma.unsubscribe.count({ where: { normalizedEmail: ADDRESS_A } }),
    ).toBe(0);
  });

  it("unsubscribes on a confirmed POST", async () => {
    const { token } = await linkFor(ADDRESS_A);
    const result = await confirmUnsubscribe(token);

    expect(result).toEqual({ ok: true, alreadyUnsubscribed: false });
    const row = await prisma.unsubscribe.findFirstOrThrow({
      where: { normalizedEmail: ADDRESS_A },
    });
    expect(row.scope).toBe("GLOBAL");
    expect(row.source).toBe("RECIPIENT_LINK");
    expect(row.campaignId).toBe(campaignId);
  });

  it("is idempotent across a refresh, a double click and a retry", async () => {
    const { token } = await linkFor(ADDRESS_A);

    const first = await confirmUnsubscribe(token);
    const second = await confirmUnsubscribe(token);
    const [third, fourth] = await Promise.all([
      confirmUnsubscribe(token),
      confirmUnsubscribe(token),
    ]);

    expect(first).toEqual({ ok: true, alreadyUnsubscribed: false });
    expect(second).toEqual({ ok: true, alreadyUnsubscribed: true });
    expect(third.ok && fourth.ok).toBe(true);

    // One address, one unsubscribe. The unique (normalizedEmail, scope) is the guard.
    expect(
      await prisma.unsubscribe.count({ where: { normalizedEmail: ADDRESS_A } }),
    ).toBe(1);
  });

  // ---- 8..10 immediate effect --------------------------------------------

  it("excludes the address from an audience immediately", async () => {
    const definition = {
      version: 1,
      conditions: [
        { field: "company.name", operator: Operator.STARTS_WITH, value: RUN },
      ],
      groups: [],
      include: { companyEmails: true, contactEmails: false },
    };

    const before = await previewAudience(definition);
    expect(before.destinations.map((d2) => d2.normalizedEmail)).toContain(ADDRESS_A);

    const { token } = await linkFor(ADDRESS_A);
    await confirmUnsubscribe(token);

    const after = await previewAudience(definition);
    expect(after.destinations.map((d2) => d2.normalizedEmail)).not.toContain(ADDRESS_A);
    // Exclusions carry the address exactly as the CRM record held it; the resolver
    // only normalizes what it keeps, so match on either form.
    expect(
      after.exclusions.find(
        (e) => e.normalizedEmail === ADDRESS_A || e.rawEmail === ADDRESS_A,
      )?.reason,
    ).toBe("UNSUBSCRIBED");
  });

  it("cannot be overridden by a GRANTED consent", async () => {
    const address = await prisma.communicationAddress.findUniqueOrThrow({
      where: { normalizedEmail: ADDRESS_A },
    });
    await setConsent({
      status: ConsentStatus.GRANTED,
      addressIds: [address.id],
      source: ConsentSource.EXISTING_CUSTOMER_RELATIONSHIP,
      effectiveAt: "2026-01-10",
      confirmed: "on",
    });

    const { token } = await linkFor(ADDRESS_A);
    await confirmUnsubscribe(token);

    const preview = await previewAudience({
      version: 1,
      conditions: [
        { field: "company.name", operator: Operator.STARTS_WITH, value: RUN },
      ],
      groups: [],
      include: { companyEmails: true, contactEmails: false },
    });
    expect(preview.destinations.map((d2) => d2.normalizedEmail)).not.toContain(
      ADDRESS_A,
    );

    // Restore, so later tests start from a clean consent state.
    await prisma.communicationAddress.update({
      where: { id: address.id },
      data: { consentStatus: ConsentStatus.UNKNOWN, consentSource: null },
    });
  });

  it("cannot be overridden by a matching language", async () => {
    const { token } = await linkFor(ADDRESS_A);
    await confirmUnsubscribe(token);

    // Hebrew address, Hebrew campaign — and still excluded.
    const preview = await previewAudience(
      {
        version: 1,
        conditions: [
          { field: "company.name", operator: Operator.STARTS_WITH, value: RUN },
        ],
        groups: [],
        include: { companyEmails: true, contactEmails: false },
      },
      { requireLanguage: Language.HE },
    );
    expect(preview.destinations.map((d2) => d2.normalizedEmail)).not.toContain(
      ADDRESS_A,
    );
  });

  // ---- 11..12 readiness reacts -------------------------------------------

  it("makes an existing final audience stale and its approval not ready", async () => {
    await prepareFinalAudience(campaignId, randomUUID());
    actAs(approver);
    await approveForProduction(campaignId);
    actAs(staff);

    const before = await getSendReadiness(campaignId);
    expect(before?.stalenessMessage).toBeNull();
    expect(before?.approval?.valid).toBe(true);

    const { token } = await linkFor(ADDRESS_A);
    await confirmUnsubscribe(token);

    const after = await getSendReadiness(campaignId);
    expect(after?.stalenessMessage).toContain("Prepare the final audience again");
    expect(after?.approval?.valid).toBe(false);
    expect(
      after?.readiness.checks.find((c) => c.key === "final-audience")?.status,
    ).toBe("BLOCKED");
  });

  // ---- 13..14 public and silent -------------------------------------------

  it("requires no authentication", async () => {
    const { token } = await linkFor(ADDRESS_A);

    // Nobody is signed in at all.
    actAs(null);
    const lookup = await lookupUnsubscribeToken(token);
    expect(lookup.ok).toBe(true);

    const result = await confirmUnsubscribe(token);
    expect(result).toEqual({ ok: true, alreadyUnsubscribed: false });

    actAs(staff);
  });

  it("leaks nothing from an invalid token", async () => {
    const unknown = await lookupUnsubscribeToken(mintUnsubscribeToken().token);
    const malformed = await lookupUnsubscribeToken("../../etc/passwd");
    const empty = await lookupUnsubscribeToken("");

    // Every failure is the SAME sentence, so the endpoint is not an oracle for
    // discovering which addresses AXIS holds.
    const messages = new Set(
      [unknown, malformed, empty].map((r) => (r.ok ? "" : r.message)),
    );
    expect(messages.size).toBe(1);
    for (const result of [unknown, malformed, empty]) {
      const blob = JSON.stringify(result);
      expect(blob).not.toContain("@example.test");
      expect(blob).not.toContain(RUN);
    }
  });

  it("throttles repeated invalid attempts without blocking a real recipient", async () => {
    const { token } = await linkFor(ADDRESS_B);

    let limited = false;
    for (let i = 0; i < 60; i++) {
      const result = await lookupUnsubscribeToken(mintUnsubscribeToken().token, {
        clientKey: "1.2.3.4",
      });
      if (!result.ok && result.reason === "RATE_LIMITED") limited = true;
    }
    expect(limited).toBe(true);

    // The genuine recipient, from the SAME client, is still served.
    const valid = await lookupUnsubscribeToken(token, { clientKey: "1.2.3.4" });
    expect(valid.ok).toBe(true);
  });

  // ---- 15 audit ------------------------------------------------------------

  it("records a public action that is distinguishable from a staff action", async () => {
    const { token } = await linkFor(ADDRESS_A);
    await confirmUnsubscribe(token);

    const address = await prisma.communicationAddress.findUniqueOrThrow({
      where: { normalizedEmail: ADDRESS_A },
    });
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: "UNSUBSCRIBE", entityId: address.id },
      orderBy: [{ occurredAt: "desc" }],
    });

    // NULL actor: a recipient is not an AXIS employee, and no colleague's name may be
    // attached to something a customer did.
    expect(entry.actorUserId).toBeNull();
    expect(entry.fromState).toBe("SUBSCRIBED");
    expect(entry.toState).toBe("UNSUBSCRIBED");
    const metadata = entry.metadata as Record<string, unknown>;
    expect(metadata.actor).toBe("PUBLIC_RECIPIENT");
    expect(metadata.source).toBe("RECIPIENT_LINK");
    expect(metadata.campaignId).toBe(campaignId);
    // The token itself is never recorded — only which row was used.
    expect(JSON.stringify(metadata)).not.toContain(token);
  });

  it("keeps the address and its CRM provenance", async () => {
    const { token } = await linkFor(ADDRESS_A);
    await confirmUnsubscribe(token);

    // Nothing is deleted: the profile, the company and the link all survive.
    expect(
      await prisma.communicationAddress.count({ where: { normalizedEmail: ADDRESS_A } }),
    ).toBe(1);
    expect(
      await prisma.company.count({ where: { companyEmailNorm: ADDRESS_A } }),
    ).toBe(1);
  });

  // ---- 16 the SAFE TEST link is inert -------------------------------------

  it("cannot let a test email unsubscribe any customer", async () => {
    const lookup = await lookupUnsubscribeToken(TEST_UNSUBSCRIBE_TOKEN);
    expect(lookup.ok).toBe(false);
    expect(lookup.ok === false && lookup.reason).toBe("TEST_TOKEN");

    const confirmed = await confirmUnsubscribe(TEST_UNSUBSCRIBE_TOKEN);
    expect(confirmed.ok).toBe(false);

    // Not one unsubscribe anywhere in the database as a result.
    expect(
      await prisma.unsubscribe.count({ where: { normalizedEmail: { in: ALL } } }),
    ).toBe(0);
  });

  // ---- 17..19 the footer is unchanged --------------------------------------

  it("renders exactly one unsubscribe link, in the footer", async () => {
    const campaign = await getNewsletter(campaignId);
    if (!campaign) throw new Error("fixture missing");
    const html = renderNewsletterHtml(buildNewsletterDocument(campaign));

    const occurrences = (html.match(/הסרה מרשימת התפוצה/g) ?? []).length;
    expect(occurrences).toBe(1);

    // And it sits at the end of the message, not beside the sender.
    expect(html.indexOf("הסרה מרשימת התפוצה")).toBeGreaterThan(html.length * 0.5);
  });

  it("emits no List-Unsubscribe headers anywhere", () => {
    // ADR-0019 keeps unsubscribe footer-only. Adding a Gmail one-click header later
    // must be a deliberate act, not a side effect of this milestone.
    for (const file of [
      "src/domain/email/newsletterTemplate.ts",
      "src/server/integrations/email/gmailSmtpEmailProvider.ts",
      "src/server/services/unsubscribeService.ts",
      "src/server/services/deliveryService.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      // The only occurrences permitted are comments recording their absence.
      const emitted = source
        .split("\n")
        .filter((line) => line.includes("List-Unsubscribe"))
        .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"));
      expect(emitted, file).toEqual([]);
    }
  });

  it("keeps the plain-text footer to one unsubscribe line", async () => {
    const campaign = await getNewsletter(campaignId);
    if (!campaign) throw new Error("fixture missing");
    const text = renderNewsletterText(buildNewsletterDocument(campaign));
    expect((text.match(/הסרה מרשימת התפוצה/g) ?? []).length).toBe(1);
  });
});
