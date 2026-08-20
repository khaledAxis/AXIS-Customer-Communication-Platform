import { Capability, requirePageCapability } from "../../../server/auth/session";
import {
  getEmailInfrastructure,
  type FactState,
  type InfrastructureFact,
} from "../../../server/services/emailInfrastructureService";
import { Card, PageHeader } from "../../../ui/primitives";
import { checkDomainAction } from "./actions";

/**
 * Email infrastructure — administrators only.
 *
 * The screen deliberately does NOT summarise itself into a single "ready" badge. Each
 * fact is reported separately, with its own state, because they fail independently and
 * a green light averaged over them would be a lie: a verified domain with no webhook
 * secret still cannot record a bounce, and a perfect local configuration still cannot
 * send while the production switch is off.
 *
 * Nothing here writes a credential, a switch, or a DNS record. The only action reads
 * the domain's state from the provider.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Email infrastructure — AXIS" };

const STATE_STYLE: Record<FactState, { chip: string; label: string }> = {
  OK: { chip: "bg-emerald-100 text-emerald-800", label: "OK" },
  ACTION_REQUIRED: { chip: "bg-amber-100 text-amber-900", label: "Action required" },
  UNKNOWN: { chip: "bg-slate-200 text-slate-700", label: "Not checked" },
  LOCKED: { chip: "bg-slate-800 text-white", label: "Locked" },
};

function Fact({ fact }: { fact: InfrastructureFact }) {
  const style = STATE_STYLE[fact.state];
  return (
    <li className="border-t border-slate-200 py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-900">{fact.label}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${style.chip}`}
        >
          {style.label}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-700">{fact.detail}</p>
      {fact.remedy ? (
        <p className="mt-1 text-xs leading-relaxed text-slate-600">{fact.remedy}</p>
      ) : null}
    </li>
  );
}

function FactCard({
  title,
  description,
  facts,
  children,
}: {
  title: string;
  description?: string;
  facts: InfrastructureFact[];
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      {description ? (
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      ) : null}
      <ul className="mt-3">
        {facts.map((fact) => (
          <Fact key={fact.label} fact={fact} />
        ))}
      </ul>
      {children}
    </Card>
  );
}

function DnsValue({ value }: { value: string }) {
  return (
    <code
      dir="ltr"
      className="mt-1 block overflow-x-auto whitespace-pre rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-800"
    >
      {value}
    </code>
  );
}

export default async function EmailInfrastructurePage({
  searchParams,
}: {
  searchParams: Promise<{ checked?: string; error?: string }>;
}) {
  await requirePageCapability(Capability.MANAGE_USERS, "/admin/email-infrastructure");
  const feedback = await searchParams;
  const view = await getEmailInfrastructure();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email infrastructure"
        description="What would actually happen if AXIS sent a newsletter — provider, sender, domain authentication, delivery events, unsubscribe, and the production lock. Each is reported separately; there is deliberately no single ready badge."
      />

      {feedback.checked ? (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">
            Domain state read from the provider.
          </p>
        </div>
      ) : null}
      {feedback.error ? (
        <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-900">{feedback.error}</p>
        </div>
      ) : null}

      {/* ---------------- production lock, first, because it decides everything ---- */}
      <FactCard
        title="Production sending"
        description="Read from the environment at server start. Not in the database — no page, and no role including ADMIN, can change these from a browser."
        facts={view.productionSending.facts}
      />

      {/* ---------------- provider ---------------- */}
      <FactCard
        title={`Provider — ${view.provider.name}`}
        description="The bulk transport for customer newsletters. Separate from the Gmail SAFE TEST transport, which is a different port and a different code path."
        facts={view.provider.facts}
      >
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
          The API key lives in <code className="font-mono">{view.provider.keyLocation}</code>.
          This platform never displays it, never writes it to the database, and never
          includes it in a log line or an error message — not even partially.
        </p>
      </FactCard>

      {/* ---------------- sender identities ---------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">Sender identities</h2>
        <p className="mt-1 text-sm text-slate-600">
          Two channels, two senders. Neither is configurable per newsletter.
        </p>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Production / pilot from
            </dt>
            <dd className="mt-1 font-mono text-xs text-slate-800">
              {view.sender.productionFrom}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Replies go to
            </dt>
            <dd className="mt-1 font-mono text-xs text-slate-800">
              {view.sender.productionReplyTo ?? "Not configured"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              SAFE TEST (Gmail)
            </dt>
            <dd className="mt-1 font-mono text-xs text-slate-800">
              {view.sender.safeTestFrom} → {view.sender.safeTestTo}
            </dd>
          </div>
        </dl>
      </Card>

      {/* ---------------- domain authentication ---------------- */}
      <FactCard
        title={`Sending domain — ${view.domain.domain ?? "not configured"}`}
        description={
          view.domain.lastCheckedAt
            ? `Last read from the provider on ${view.domain.lastCheckedAt.toLocaleString("en-GB")}. This is a stored snapshot, not a live answer.`
            : "Never checked. Nothing below is assumed from local configuration."
        }
        facts={view.domain.facts}
      >
        <form action={checkDomainAction} className="mt-4">
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Check domain now
          </button>
          <span className="ms-3 text-xs text-slate-600">
            Reads the domain&rsquo;s state from the provider. Changes nothing, sends
            nothing.
          </span>
        </form>

        {view.domain.records.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-sm font-bold text-slate-900">
              DNS records to publish in the axis-gps.com zone
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Published by whoever administers AXIS DNS. This platform never edits DNS
              and never invents a record value — every value below came from the
              provider.
            </p>
            <ul className="mt-2 space-y-3">
              {view.domain.records.map((record) => (
                <li
                  key={`${record.type}-${record.name}-${record.value.slice(0, 24)}`}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-slate-800 px-2 py-0.5 font-bold text-white">
                      {record.type}
                    </span>
                    <span className="font-semibold text-slate-700">{record.purpose}</span>
                    {record.status ? (
                      <span className="text-slate-500">· {record.status}</span>
                    ) : null}
                  </div>
                  <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Name
                  </div>
                  <DnsValue value={record.name} />
                  <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Value
                  </div>
                  <DnsValue value={record.value} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </FactCard>

      {/* ---------------- SPF guidance ---------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">SPF</h2>
        <p className="mt-1 text-sm text-slate-600">
          A domain may publish exactly ONE SPF record. Two is not more permissive — it
          is a permanent error that fails every check.
        </p>
        {view.spf.recommended ? <DnsValue value={view.spf.recommended} /> : null}
        <ul className="mt-2 list-disc space-y-1 ps-5 text-xs text-slate-600">
          {view.spf.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </Card>

      {/* ---------------- DMARC guidance ---------------- */}
      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">DMARC</h2>
        <p className="mt-1 text-sm text-slate-600">
          AXIS publishes this, not the provider. Roll it out in stages and read the
          reports in between.
        </p>
        <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Host
        </div>
        <DnsValue value={view.dmarc.host} />
        <ul className="mt-3 space-y-3">
          {view.dmarc.stages.map((stage, index) => (
            <li key={stage.policy} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-bold text-white">
                  Stage {index + 1}
                </span>
                <span className="font-mono text-xs font-bold text-slate-800">
                  {stage.policy}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-700">{stage.when}</p>
              <DnsValue value={stage.value} />
            </li>
          ))}
        </ul>
        <ul className="mt-3 list-disc space-y-1 ps-5 text-xs text-slate-600">
          {view.dmarc.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </Card>

      {/* ---------------- webhook ---------------- */}
      <FactCard
        title="Delivery events (webhook)"
        description="How bounces, complaints and deliveries reach this platform. Every inbound request is signature-verified before its body is read; an unverifiable one is refused and changes nothing."
        facts={view.webhook.facts}
      >
        <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Endpoint path
        </div>
        <DnsValue value={view.webhook.path} />
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          Do not expose this development machine to the internet to receive webhooks —
          no port forwarding, no tunnel left running. Deploy the app to an internal
          HTTPS host first. Until then, delivery events simply do not arrive, which is
          a known and acceptable state while sending is locked.
        </p>
      </FactCard>

      {/* ---------------- public unsubscribe ---------------- */}
      <FactCard
        title="Public unsubscribe"
        description="A recipient must be able to unsubscribe with no account and no login, from wherever they open the newsletter."
        facts={view.publicUnsubscribe.facts}
      />
    </div>
  );
}
