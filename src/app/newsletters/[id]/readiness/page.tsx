import Link from "next/link";
import { notFound } from "next/navigation";

import {
  READINESS_GROUP_LABEL,
  type ReadinessCheck,
  type ReadinessGroup,
} from "../../../../domain/campaign/sendReadiness";
import {
  getSendReadiness,
  inspectFinalAudience,
} from "../../../../server/services/sendReadinessService";
import { getDeliveryLedger } from "../../../../server/services/deliveryService";
import {
  ApproveProductionButtons,
  PrepareAudienceButton,
  PrepareLedgerButton,
} from "../../../../ui/ReadinessActions";
import {
  CONSENT_STATUS_LABEL,
  CONSENT_STATUS_TONE,
  EMAIL_SOURCE_LABEL,
  EXCLUSION_REASON_HINT,
  EXCLUSION_REASON_LABEL,
  LANGUAGE_LABEL,
  READINESS_STATUS_ICON,
  READINESS_STATUS_LABEL,
  READINESS_STATUS_TONE,
} from "../../../../ui/labels";
import {
  Badge,
  Card,
  PageHeader,
  buttonSecondary,
  buttonSubtle,
} from "../../../../ui/primitives";
import {
  approveProductionAction,
  prepareDeliveryLedgerAction,
  prepareFinalAudienceAction,
  revokeProductionApprovalAction,
} from "../readinessActions";
import { Capability, requirePageCapability } from "../../../../server/auth/session";

/**
 * SEND READINESS.
 *
 * Answers, in one place: who matches, who is eligible, why anyone was excluded, is
 * the audience still current, has this exact newsletter been approved, and is
 * everything ready for production.
 *
 * The last answer is always no, deliberately: production customer sending has not
 * been enabled, the button below is locked, and there is no route behind it. Every
 * other question is answered from live data plus the frozen audience.
 */

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const GROUP_ORDER: ReadinessGroup[] = [
  "CONTENT",
  "AUDIENCE",
  "COMMUNICATION",
  "APPROVAL",
  "INFRASTRUCTURE",
];

function CheckRow({ check }: { check: ReadinessCheck }) {
  const tone = READINESS_STATUS_TONE[check.status] ?? "neutral";
  const colour =
    check.status === "READY"
      ? "text-emerald-700"
      : check.status === "WARNING"
        ? "text-amber-700"
        : "text-rose-700";

  return (
    <li className="flex items-start gap-3 py-2.5">
      <span aria-hidden className={`mt-0.5 text-base font-bold ${colour}`}>
        {READINESS_STATUS_ICON[check.status]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{check.label}</span>
          <Badge tone={tone}>{READINESS_STATUS_LABEL[check.status]}</Badge>
        </div>
        <p className="mt-0.5 text-sm text-slate-600">{check.detail}</p>
      </div>
    </li>
  );
}

/** Plain-English delivery states. Raw enum names never reach a screen. */
const DELIVERY_STATE_LABEL: Record<string, string> = {
  PENDING: "Prepared, not sent",
  READY: "Ready to submit",
  SENDING: "Submitting",
  ACCEPTED: "Accepted by provider",
  DELIVERED: "Delivered",
  BOUNCED: "Bounced",
  COMPLAINED: "Reported as spam",
  FAILED: "Failed",
  UNCERTAIN: "Outcome unknown",
  SUPPRESSED: "Suppressed before sending",
  SENT: "Sent",
};

function InfraRow({
  label,
  value,
  ready,
}: {
  label: string;
  value: string;
  ready: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 py-2">
      <dt className="w-52 shrink-0 text-sm font-semibold text-slate-800">{label}</dt>
      <dd className="flex-1 text-sm text-slate-700">
        <Badge tone={ready ? "success" : "danger"}>
          {ready ? "Ready" : "Not ready"}
        </Badge>{" "}
        <span className="ms-1">{value}</span>
      </dd>
    </div>
  );
}

/** "Name <email>" when both are known, otherwise whichever exists. */
function person(who: { email: string; name: string | null } | null): string {
  if (!who) return "—";
  return who.name ? `${who.name} (${who.email})` : who.email;
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3.5">
      <p className="text-xl font-bold tabular-nums text-slate-900">
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 text-xs font-medium text-slate-700">{label}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export default async function ReadinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  // Server-side gate. The proxy redirects anonymous traffic early; this is
  // the check that actually decides, next to the data (ADR-0023).
  await requirePageCapability(Capability.MANAGE_NEWSLETTERS, "/newsletters");
  const { id } = await params;
  const search = await searchParams;
  const view = one(search.view) === "excluded" ? "EXCLUDED" : one(search.view) === "eligible" ? "ELIGIBLE" : null;
  const page = Number(one(search.page) ?? "1") || 1;

  const readiness = await getSendReadiness(id);
  if (!readiness) notFound();

  const inspection =
    view !== null ? await inspectFinalAudience(id, { view, page }) : null;
  const ledger = await getDeliveryLedger(id);

  const frozen = readiness.finalAudience;
  const blocking = readiness.readiness.checks.filter(
    (c) =>
      c.status === "BLOCKED" &&
      c.group !== "INFRASTRUCTURE" &&
      c.key !== "approval" &&
      c.key !== "four-eyes",
  );

  const infra = readiness.deliveryInfrastructure;

  const inspectHref = (nextView: string, nextPage = 1) =>
    `/newsletters/${id}/readiness?view=${nextView}&page=${nextPage}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Send readiness"
        description={readiness.campaignName}
        actions={
          <>
            <Badge tone="warning">Test mode</Badge>
            <Link href={`/newsletters/${id}`} className={buttonSecondary}>
              Back to newsletter
            </Link>
            <Link href={`/newsletters/${id}/preview`} className={buttonSecondary}>
              Preview email
            </Link>
          </>
        }
      />

      {/* ---------------------------- checklist ---------------------------- */}
      <Card className="p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">Readiness checklist</h2>
          <p className="text-sm text-slate-600">
            {readiness.readiness.blockedCount} blocked ·{" "}
            {readiness.readiness.warningCount} to check
          </p>
        </div>

        <div className="mt-4 space-y-5">
          {GROUP_ORDER.map((group) => {
            const checks = readiness.readiness.checks.filter((c) => c.group === group);
            if (checks.length === 0) return null;
            return (
              <div key={group}>
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {READINESS_GROUP_LABEL[group]}
                </h3>
                <ul className="mt-1 divide-y divide-slate-100">
                  {checks.map((check) => (
                    <CheckRow key={check.key} check={check} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ------------------------- audience figures ------------------------ */}
      <Card className="p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">Final audience</h2>
          {readiness.segment ? (
            <p className="text-sm text-slate-600">
              Audience: <strong>{readiness.segment.name}</strong> · Newsletter language:{" "}
              <strong>{LANGUAGE_LABEL[readiness.campaignLanguage]}</strong>
            </p>
          ) : null}
        </div>

        {frozen ? (
          <>
            <p className="mt-1 text-sm text-slate-600">
              Frozen on {frozen.createdAt.toLocaleString("en-GB")}. This snapshot never
              changes; preparing again creates a new one.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Figure
                label="Matched CRM records"
                value={frozen.matchedRecords}
                hint={`${frozen.matchedCompanies.toLocaleString()} companies · ${frozen.matchedContacts.toLocaleString()} contacts`}
              />
              <Figure
                label="Unique email addresses"
                value={frozen.uniqueDestinations}
                hint="After removing duplicates"
              />
              <Figure
                label="Duplicates collapsed"
                value={frozen.duplicateSourcesCollapsed}
                hint="Kept as sources, not excluded"
              />
              <Figure
                label="Eligible"
                value={frozen.uniqueDestinations}
                hint="Would receive this newsletter"
              />
              <Figure
                label="Excluded"
                value={frozen.excluded}
                hint={`${frozen.exclusionsRecorded.toLocaleString()} recorded with a reason`}
              />
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Figure
                label="Approved for communication"
                value={frozen.consentGranted}
                hint="A person recorded a documented basis"
              />
              <Figure
                label="Consent not confirmed"
                value={frozen.consentNotConfirmed}
                hint="Nobody refused, and nobody confirmed"
              />
            </div>

            {/* ------------------------ exclusions ------------------------ */}
            <h3 className="mt-6 text-sm font-bold text-slate-900">
              Why records were excluded
            </h3>
            {Object.entries(frozen.breakdown).filter(([, count]) => count > 0).length ===
            0 ? (
              <p className="mt-1 text-sm text-slate-600">
                Nothing was excluded from this audience.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {Object.entries(frozen.breakdown)
                  .filter(([, count]) => count > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([reason, count]) => (
                    <li
                      key={reason}
                      className="flex flex-wrap items-baseline gap-x-3 py-2"
                    >
                      <span className="w-16 shrink-0 text-sm font-bold tabular-nums text-slate-900">
                        {count.toLocaleString()}
                      </span>
                      <span className="text-sm text-slate-800">
                        {EXCLUSION_REASON_LABEL[reason] ?? reason}
                      </span>
                      {EXCLUSION_REASON_HINT[reason] ? (
                        <span className="text-xs text-slate-500">
                          {EXCLUSION_REASON_HINT[reason]}
                        </span>
                      ) : null}
                    </li>
                  ))}
              </ul>
            )}

            {readiness.live ? (
              <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-600">
                Live figures right now:{" "}
                {readiness.live.uniqueDestinations.toLocaleString()} addresses,{" "}
                {readiness.live.excluded.toLocaleString()} excluded.{" "}
                {readiness.stalenessMessage
                  ? readiness.stalenessMessage
                  : readiness.audienceVerifiedByWatermark
                    ? "Nothing that affects this audience has changed since it was frozen, so these are the same figures."
                    : "These match the frozen snapshot."}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={inspectHref("eligible")} className={buttonSecondary}>
                View eligible addresses
              </Link>
              <Link href={inspectHref("excluded")} className={buttonSecondary}>
                View exclusions
              </Link>
              {view ? (
                <Link href={`/newsletters/${id}/readiness`} className={buttonSubtle}>
                  Hide list
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            No final audience has been prepared yet.{" "}
            {readiness.segment
              ? "Prepare one to freeze exactly who would receive this newsletter."
              : "Choose an audience on the newsletter page first."}
          </p>
        )}

        <div className="mt-5 border-t border-slate-200 pt-4">
          <PrepareAudienceButton
            campaignId={id}
            action={prepareFinalAudienceAction}
            hasExisting={frozen !== null}
            disabled={readiness.segment === null}
          />
        </div>
      </Card>

      {/* ------------------------- audience listing ------------------------ */}
      {inspection ? (
        <Card className="p-6">
          <h2 className="text-lg font-bold text-slate-900">
            {view === "ELIGIBLE"
              ? `Eligible addresses (${inspection.total.toLocaleString()})`
              : `Exclusions (${inspection.total.toLocaleString()})`}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            From the frozen snapshot taken on{" "}
            {inspection.createdAt.toLocaleString("en-GB")}. Accounting addresses are
            never part of an audience.
          </p>

          <div className="mt-4 overflow-x-auto">
            {view === "ELIGIBLE" ? (
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-3 py-2.5 text-start font-semibold text-slate-700">
                      Email address
                    </th>
                    <th className="px-3 py-2.5 text-start font-semibold text-slate-700">
                      Language
                    </th>
                    <th className="px-3 py-2.5 text-start font-semibold text-slate-700">
                      Consent
                    </th>
                    <th className="px-3 py-2.5 text-start font-semibold text-slate-700">
                      Comes from
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inspection.destinations.map((row) => (
                    <tr key={row.normalizedEmail}>
                      <td className="px-3 py-2.5 align-top">
                        <span className="break-all font-medium text-slate-900" dir="ltr">
                          {row.normalizedEmail}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-top text-slate-700">
                        {LANGUAGE_LABEL[row.language] ?? row.language}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <Badge tone={CONSENT_STATUS_TONE[row.consentStatus] ?? "neutral"}>
                          {CONSENT_STATUS_LABEL[row.consentStatus] ?? row.consentStatus}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <ul className="space-y-0.5 text-xs text-slate-700">
                          {row.sources.map((source, index) => (
                            <li key={`${source.sourceItemId}-${index}`}>
                              <span className="text-slate-500">
                                {EMAIL_SOURCE_LABEL[source.emailSourceType] ??
                                  source.emailSourceType}
                                :
                              </span>{" "}
                              {source.label}
                              {source.companyName ? (
                                <span className="text-slate-400">
                                  {" "}
                                  ({source.companyName})
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-3 py-2.5 text-start font-semibold text-slate-700">
                      CRM record
                    </th>
                    <th className="px-3 py-2.5 text-start font-semibold text-slate-700">
                      Address
                    </th>
                    <th className="px-3 py-2.5 text-start font-semibold text-slate-700">
                      Why it was excluded
                    </th>
                    <th className="px-3 py-2.5 text-start font-semibold text-slate-700">
                      What to do
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inspection.exclusions.map((row, index) => (
                    <tr key={`${row.label}-${row.address ?? "none"}-${index}`}>
                      <td className="px-3 py-2.5 align-top text-slate-800">
                        {row.label}
                        <span className="block text-xs text-slate-500">
                          {EMAIL_SOURCE_LABEL[row.kind] ?? row.kind}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 align-top" dir="ltr">
                        {row.address ?? (
                          <span className="text-slate-400">No address</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-top text-slate-800">
                        {EXCLUSION_REASON_LABEL[row.reason] ?? row.reason}
                      </td>
                      <td className="px-3 py-2.5 align-top text-xs text-slate-600">
                        {EXCLUSION_REASON_HINT[row.reason] ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {inspection.pageCount > 1 ? (
            <div className="mt-4 flex items-center justify-between">
              {inspection.page > 1 ? (
                <Link
                  href={inspectHref(
                    view === "ELIGIBLE" ? "eligible" : "excluded",
                    inspection.page - 1,
                  )}
                  className={buttonSecondary}
                >
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-slate-600">
                Page {inspection.page} of {inspection.pageCount}
              </span>
              {inspection.page < inspection.pageCount ? (
                <Link
                  href={inspectHref(
                    view === "ELIGIBLE" ? "eligible" : "excluded",
                    inspection.page + 1,
                  )}
                  className={buttonSecondary}
                >
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ---------------------------- approval ----------------------------- */}
      <Card className="p-6">
        <h2 className="text-lg font-bold text-slate-900">Approval</h2>
        <p className="mt-1 text-sm text-slate-600">
          An approval covers one exact newsletter sent to one exact frozen audience. If
          the subject, an article, a picture, the reply address or the audience changes
          afterwards, the approval stops being valid.
        </p>

        {/* ------------------------ who did what ------------------------ */}
        <dl className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">Prepared by</dt>
            <dd className="text-slate-800">
              {person(readiness.preparedBy)}
              {readiness.preparedBy === null ? " (unknown)" : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Audience frozen by</dt>
            <dd className="text-slate-800">{person(readiness.audiencePreparedBy)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Approved by</dt>
            <dd className="text-slate-800">
              {readiness.approval
                ? `${person({
                    email: readiness.approval.approvedByEmail ?? "unknown",
                    name: readiness.approval.approvedByName,
                  })} · ${readiness.approval.approvedAt.toLocaleString("en-GB")}`
                : "Not approved yet"}
            </dd>
          </div>
        </dl>

        {readiness.approval ? (
          readiness.approval.problem ? (
            <p className="mt-2 text-sm font-semibold text-rose-700">
              Approval invalidated — {readiness.approval.problem}
            </p>
          ) : (
            <p className="mt-2 text-sm text-emerald-700">
              Still valid for the current newsletter and audience.
            </p>
          )
        ) : null}

        {readiness.approval && !readiness.approval.authenticatedActor ? (
          <p className="mt-2 text-xs text-slate-500">
            This approval predates sign-in and was recorded against the development
            stand-in, so it can never satisfy the second-person rule.
          </p>
        ) : null}

        {/* --------------------------- four eyes -------------------------- */}
        {!readiness.fourEyes.satisfied ? (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
            <p className="font-semibold">
              {readiness.viewerIsCreator
                ? "You prepared this newsletter, so you cannot approve it."
                : "Waiting for a second person to approve."}
            </p>
            <p className="mt-1">
              {readiness.viewerIsCreator
                ? "A different authorized AXIS user must approve this campaign."
                : readiness.fourEyes.problem}
            </p>
          </div>
        ) : null}

        <div className="mt-4">
          <ApproveProductionButtons
            campaignId={id}
            approveAction={approveProductionAction}
            revokeAction={revokeProductionApprovalAction}
            eligibleCount={frozen?.uniqueDestinations ?? 0}
            hasValidApproval={readiness.approval?.valid === true}
            // Hiding the control is a courtesy. `approveForProduction` re-runs the
            // four-eyes rule against the session and refuses regardless of what the
            // browser sends.
            disabled={blocking.length > 0 || readiness.viewerIsCreator}
            blockedReason={
              readiness.viewerIsCreator
                ? "A different authorized AXIS user must approve this campaign."
                : (blocking[0]?.detail ?? null)
            }
          />
        </div>
      </Card>

      {/* --------------------- delivery infrastructure --------------------- */}
      <Card className="p-6">
        <h2 className="text-lg font-bold text-slate-900">Delivery infrastructure</h2>
        <p className="mt-1 text-sm text-slate-600">
          What has to exist before a single customer message can go out. Every line is
          read from configuration — nothing is assumed to be in place.
        </p>

        <dl className="mt-4 divide-y divide-slate-100">
          <InfraRow
            label="Production sender"
            value={infra.productionSender ?? "Not configured"}
            ready={infra.productionSender !== null}
          />
          <InfraRow
            label="Domain authentication"
            value={
              infra.domainCheckedAt
                ? `SPF ${infra.domain.spf} · DKIM ${infra.domain.dkim} · DMARC ${infra.domain.dmarc}` +
                  ` (checked ${infra.domainCheckedAt.toLocaleDateString("en-GB")})`
                : infra.domain.domain
                  ? `${infra.domain.domain} — never checked with the provider`
                  : "Not verified — no sending domain has been authenticated"
            }
            ready={
              infra.domain.spf === "VERIFIED" &&
              infra.domain.dkim === "VERIFIED" &&
              infra.domain.dmarc === "VERIFIED"
            }
          />
          <InfraRow
            label="Public unsubscribe"
            value={
              infra.publicUnsubscribe.productionReady
                ? `Ready — ${infra.publicUnsubscribe.origin}`
                : infra.publicUnsubscribe.configured
                  ? `Development only — ${infra.publicUnsubscribe.origin}`
                  : "Not configured"
            }
            ready={infra.publicUnsubscribe.productionReady}
          />
          <InfraRow
            label="Delivery events (webhook)"
            value={
              !infra.webhook.secretConfigured
                ? "No signing secret — bounces and complaints cannot be received"
                : infra.webhook.reachable
                  ? `Ready — ${infra.webhook.url}`
                  : "Signing secret set, but this app has no publicly reachable address"
            }
            ready={infra.webhook.secretConfigured && infra.webhook.reachable}
          />
          <InfraRow
            label="Production provider"
            value={
              infra.providerConfigured
                ? infra.providerName
                : "Not configured — no vendor has been selected"
            }
            ready={infra.providerConfigured}
          />
          <InfraRow
            label="Production delivery"
            value="LOCKED"
            ready={false}
          />
        </dl>

        {infra.blockers.length > 0 ? (
          <ul className="mt-4 list-disc space-y-1 ps-5 text-xs text-slate-600">
            {infra.blockers.map((blocker, index) => (
              <li key={`${blocker}-${index}`}>{blocker}</li>
            ))}
          </ul>
        ) : null}

        {/* ------------------------ delivery ledger ------------------------ */}
        <div className="mt-6 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">Delivery records</h3>
            <p className="text-xs text-slate-600">
              {ledger.total === 0
                ? "None prepared"
                : `${ledger.total.toLocaleString()} prepared · none sent`}
            </p>
          </div>

          {ledger.total > 0 ? (
            <>
              <ul className="mt-2 flex flex-wrap gap-2">
                {Object.entries(ledger.byState).map(([state, count]) => (
                  <li key={state}>
                    <Badge tone={state === "PENDING" ? "info" : "neutral"}>
                      {DELIVERY_STATE_LABEL[state] ?? state}: {count.toLocaleString()}
                    </Badge>
                  </li>
                ))}
              </ul>
              {Object.keys(ledger.vetoBreakdown).length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                  {Object.entries(ledger.vetoBreakdown).map(([reason, count]) => (
                    <li key={reason}>
                      {count.toLocaleString()} suppressed —{" "}
                      {EXCLUSION_REASON_LABEL[reason] ?? reason}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-2 text-xs font-semibold text-slate-700">
                PREPARED / NOT SENT — no message has been submitted to any provider.
              </p>
            </>
          ) : null}

          <div className="mt-3">
            <PrepareLedgerButton
              campaignId={id}
              action={prepareDeliveryLedgerAction}
              eligibleCount={frozen?.uniqueDestinations ?? 0}
              disabled={readiness.approval?.valid !== true || !readiness.fourEyes.satisfied}
              blockedReason={
                readiness.approval?.valid !== true
                  ? "Approve this newsletter and its audience first."
                  : !readiness.fourEyes.satisfied
                    ? "A different authorized AXIS user must approve this campaign."
                    : null
              }
            />
          </div>
        </div>
      </Card>

      {/* --------------------------- production ---------------------------- */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold text-slate-900">Production send</h2>
          <Badge tone="danger">Locked</Badge>
        </div>
        <p className="mt-2 text-sm text-slate-700">
          Production customer sending has not been enabled.
        </p>
        <p className="mt-1 text-sm text-slate-600">
          There is no button here and no hidden route behind it — the delivery engine
          for real customer email is not built yet. Everything on this page prepares for
          that step without taking it. To send a real message today, use the safe test
          email on the preview page, which always goes to the one authorised test
          address.
        </p>
        <div className="mt-4">
          <span
            aria-disabled="true"
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-400"
          >
            🔒 Send to customers — unavailable
          </span>
        </div>
      </Card>

      {/* ------------------------------ sender ----------------------------- */}
      <Card className="p-6">
        <h2 className="text-sm font-bold text-slate-900">Sender identity</h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">From</dt>
            <dd className="text-slate-800" dir="ltr">
              {readiness.sender.senderName} &lt;{readiness.sender.fromEmail}&gt;
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Replies go to</dt>
            <dd className="text-slate-800" dir="ltr">
              {readiness.sender.replyToEmail}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Customer data last synced</dt>
            <dd className="text-slate-800">
              {readiness.crmLastSyncedAt
                ? readiness.crmLastSyncedAt.toLocaleString("en-GB")
                : "Never in this environment"}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
