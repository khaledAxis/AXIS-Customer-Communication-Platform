import Link from "next/link";

import { requirePage } from "../../server/auth/session";
import { Badge, Card, PageHeader, buttonPrimary, buttonSecondary } from "../../ui/primitives";

export const dynamic = "force-dynamic";

export const metadata = { title: "Help & activation guide — AXIS" };

const workflow = [
  {
    title: "Synchronize customer data",
    body: "A Manager or Administrator runs the manual, read-only Monday.com pull from Customers. Review the run summary before using the data. The platform mirrors CRM facts; corrections to names, companies, products, and addresses belong in Monday.com.",
    href: "/customers",
    action: "Open Customers",
  },
  {
    title: "Complete communication decisions",
    body: "Open Communication and assign a verified language and consent state. DENIED consent always excludes an address. UNKNOWN means consent is unconfirmed; under the current accepted policy it remains visible as a readiness warning rather than an exclusion. Never mark consent without evidence.",
    href: "/communication",
    action: "Review communication data",
  },
  {
    title: "Build and verify an audience",
    body: "Create an Audience using the implemented company fields (classification, status, category, industry, name, newsletter-email presence, and archive state), owned-product fields (presence, name, type, catalogue number, status, subscription and warranty dates, and purchase date), contact fields (job title, name, email presence, company link, and archive state), or email settings (language, consent, address status, unsubscribe, and suppression). Inspect matched, eligible, and excluded counts separately.",
    href: "/segments",
    action: "Open Audiences",
  },
  {
    title: "Prepare approved content",
    body: "Write an internal article or review an item collected from an approved source. Set its language deliberately, check mixed Hebrew/Arabic and Latin text, add only a publicly deliverable image, and approve it before newsletter use.",
    href: "/content",
    action: "Open Content",
  },
  {
    title: "Build the newsletter",
    body: "Create one language-specific draft, select and order approved articles, and write the subject and preheader. The first included item becomes the featured article. Drafts are the only editable newsletter state.",
    href: "/newsletters",
    action: "Open Newsletters",
  },
  {
    title: "Preview every surface",
    body: "Check desktop and mobile proportions, images, calls to action, RTL direction, the public web-version link, contact details, and the footer unsubscribe link. Preview and email use the same canonical renderer.",
    href: "/newsletters",
    action: "Choose a newsletter",
  },
  {
    title: "Record and prepare the audience",
    body: "Record a planning snapshot, resolve any exclusions, then prepare the immutable final audience. Re-preparing creates a new snapshot; it does not alter an older approval. Preparing an audience or dry-run ledger sends nothing.",
    href: "/newsletters",
    action: "Open readiness",
  },
  {
    title: "Review, approve, and test safely",
    body: "A different authorized Manager or Administrator reviews the exact rendered message and production audience. No campaign creator, including an Administrator, may approve their own production audience. Use Gmail SAFE TEST for the single hard-coded recipient, or the separately gated internal QA/provider-pilot channels when configured. Provider acceptance is not proof of delivery.",
    href: "/newsletters",
    action: "Open newsletter checks",
  },
] as const;

const faqs = [
  {
    question: "Does activating the platform enable customer email?",
    answer:
      "No. Internal activation makes the application usable for staff. Real customer dispatch is deliberately unfinished and locked. There is currently no production send action, scheduler, or fan-out loop. Do not treat a green preview, approval, pilot, or dry-run ledger as permission or proof of customer delivery.",
  },
  {
    question: "Where should customer information be corrected?",
    answer:
      "In Monday.com. It is the CRM source of truth. This platform is a read-only projection and must not write CRM master data back. Language, consent, unsubscribe, suppression, newsletter history, and audit facts are locally owned and are not overwritten by synchronization.",
  },
  {
    question: "Why is a contact missing from an audience?",
    answer:
      "Check the audience exclusion details. Common causes are no valid email, unknown or mismatched language, DENIED consent, unsubscribe, suppression, a rule mismatch, or conflicting data. UNKNOWN consent means unconfirmed consent and currently raises a readiness warning rather than excluding the address; it must never be described as approved or sufficient for production.",
  },
  {
    question: "Can I use one newsletter for both Hebrew and Arabic?",
    answer:
      "No. Delivery remains language-specific. Create separate HE and AR content/newsletters, even when they refer to the same source article. Never infer a person’s communication language from their name, company, location, or browser.",
  },
  {
    question: "Why did my image disappear from the email preview?",
    answer:
      "Uploads that are invalid, oversized, unsupported, or SVG are rejected before anything is stored. Separately, the newsletter renderer omits an existing image URL when it is not deliverable to a recipient, such as a malformed, non-HTTP(S), localhost, or loopback URL. Use the configured Cloudinary media store for deliverable newsletter images; local storage is suitable only for development.",
  },
  {
    question: "What is the difference between preview, SAFE TEST, QA, and provider pilot?",
    answer:
      "Preview renders locally and sends nothing. SAFE TEST uses Gmail and can reach only the single hard-coded test recipient. QA uses a separate Gmail channel and four-address internal allowlist with durable caps. Provider pilot sends one internal Resend message from the production-domain identity. None of these channels can become customer fan-out.",
  },
  {
    question: "Why must I approve again after a small edit?",
    answer:
      "Approval is bound to a SHA-256 hash of the exact rendered message and its sender identity, destination, subject, preheader, ordered content, HTML, and text. Any meaningful difference invalidates the approval so the reviewed message cannot silently change afterward.",
  },
  {
    question: "Can the newsletter creator approve their own work?",
    answer:
      "No. Under the current production approval policy, no campaign creator may approve their own production audience, including an Administrator. A different authorized Manager or Administrator must perform the approval; this four-eyes rule is enforced server-side.",
  },
  {
    question: "Does ‘accepted’ mean the email was delivered?",
    answer:
      "No. Accepted means the provider accepted the submission. Only a verified provider delivery event can mark it delivered. An uncertain result is never automatically retried because the first submission may have succeeded and a retry could duplicate it.",
  },
  {
    question: "What happens when someone unsubscribes?",
    answer:
      "The public opaque link records the unsubscribe without requiring a login. Eligibility is re-read before dispatch, so a later unsubscribe or suppression vetoes the address even when it appeared in an older approved audience. SAFE TEST uses an inert token and cannot unsubscribe a customer.",
  },
  {
    question: "Can an automation send a newsletter automatically?",
    answer:
      "No. Assisted automation prepares a draft only. A human must review content, choose the audience, complete approval, and handle every later delivery decision. Automatic source collection also creates review-pending content rather than production-ready material.",
  },
  {
    question: "Where are passwords and provider keys entered?",
    answer:
      "Staff passwords are managed through the sign-in and user-administration flow. Infrastructure secrets belong only in the server’s git-ignored .env.local or deployment secret store. Never paste secrets into content, browser forms, commits, screenshots, logs, support messages, or this Help page.",
  },
  {
    question: "What should I do if a send result is uncertain?",
    answer:
      "Do not click again. Check the relevant provider Sent/activity view and the platform ledger, then ask an administrator to investigate. The system intentionally avoids automatic retries when submission may already have happened.",
  },
  {
    question: "Why are the Reports numbers incomplete?",
    answer:
      "Real delivery and engagement reporting is not finished. Do not use placeholder or absent metrics as evidence of delivery, opens, clicks, or campaign performance.",
  },
] as const;

function StepNumber({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-100 text-sm font-black text-sky-800 ring-1 ring-inset ring-sky-200">
      {children}
    </span>
  );
}

export default async function HelpPage() {
  const actor = await requirePage("/help");
  const isAdmin = actor.role === "ADMIN";

  return (
    <div className="space-y-10">
      <PageHeader
        title="Help & activation guide"
        description="Set up AXIS Communication safely, learn the complete newsletter workflow, and find clear answers without weakening the platform’s delivery protections."
        actions={
          <Link href="#start" className={buttonPrimary}>
            Start the guide
          </Link>
        }
      />

      <section className="grid gap-4 md:grid-cols-3" aria-label="Guide overview">
        <Card className="p-5">
          <Badge tone="info">Everyone</Badge>
          <h2 className="mt-3 font-bold text-slate-900">Learn the workflow</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Follow the newsletter process from synchronized CRM data through preview,
            audience preparation, review, and safe internal testing.
          </p>
        </Card>
        <Card className="p-5">
          <Badge tone={isAdmin ? "success" : "neutral"}>
            {isAdmin ? "You are an administrator" : "Administrator"}
          </Badge>
          <h2 className="mt-3 font-bold text-slate-900">Activate internal use</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Configure the database, first account, Monday connection, public media,
            and isolated internal email channels.
          </p>
        </Card>
        <Card className="border-amber-300 bg-amber-50 p-5">
          <Badge tone="warning">Production locked</Badge>
          <h2 className="mt-3 font-bold text-amber-950">Customer delivery is not active</h2>
          <p className="mt-1 text-sm leading-relaxed text-amber-900">
            Activation does not enable real customer dispatch. That final capability
            is unfinished and must remain off.
          </p>
        </Card>
      </section>

      <nav className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="On this page">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">On this page</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["#start", "Activation checklist"],
            ["#first-login", "First login"],
            ["#workflow", "Daily workflow"],
            ["#safety", "Safety rules"],
            ["#faq", "FAQ"],
            ["#support", "Get support"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className={buttonSecondary}>
              {label}
            </Link>
          ))}
        </div>
      </nav>

      <section id="start" className="scroll-mt-6 space-y-5">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-sky-700">Administrator guide</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Internal activation checklist
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
            Complete these steps in order. A technical administrator performs server
            configuration; normal staff should never receive database or provider credentials.
          </p>
        </div>

        <div className="space-y-4">
          {[
            {
              title: "Prepare the server and database",
              body: (
                <>
                  Install Node.js, npm, Docker, and Git. From the project directory run
                  <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">docker compose up -d</code>,
                  copy <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">.env.example</code> to the
                  git-ignored <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">.env.local</code>, set a
                  PostgreSQL <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">DATABASE_URL</code>, then run
                  <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">npm install</code> and
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">npm run db:deploy</code>.
                </>
              ),
            },
            {
              title: "Configure application and public origins",
              body: (
                <>
                  Generate a strong <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">AUTH_SECRET</code> and set
                  <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">AUTH_URL</code> to the origin Auth.js uses for
                  staff authentication. Configure <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">PUBLIC_APP_URL</code>
                  separately as the origin embedded in recipient-facing newsletter and unsubscribe links. Production requires a stable,
                  publicly reachable HTTPS deployment; never expose or tunnel the development server to provide that origin.
                  Keep <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">APP_ENV=development</code>,
                  <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">SEND_MODE=TEST</code>, and
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">PRODUCTION_DELIVERY_ENABLED=false</code> while
                  running locally or completing internal acceptance.
                </>
              ),
            },
            {
              title: "Create the first administrator",
              body: (
                <>
                  Start the application with <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">npm run dev</code>,
                  open <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">/setup</code>, and create the first
                  administrator in the browser. The setup page closes permanently after that account exists. No initial password belongs
                  in an environment file or terminal history.
                </>
              ),
            },
            {
              title: "Connect Monday.com read-only",
              body: (
                <>
                  Add a least-privilege read token as
                  <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">MONDAY_API_TOKEN</code> in
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">.env.local</code>, restart the app, then use
                  Customers to run the manual synchronization. Both Managers and Administrators may run this read-only pull. Confirm the
                  expected boards and review incomplete, invalid, conflict, and archived counts. Never grant or implement CRM write-back for v1.
                </>
              ),
            },
            {
              title: "Configure deliverable media",
              body: (
                <>
                  Local media is useful for development but cannot load from a recipient’s inbox. For real internal rendering checks, set
                  <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">MEDIA_PROVIDER=cloudinary</code> and place the
                  secret <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">CLOUDINARY_URL</code> only in the server
                  secret store. Optionally add a validated public HTTPS
                  <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">AXIS_EMAIL_LOGO_URL</code>.
                </>
              ),
            },
            {
              title: "Enable the isolated SAFE TEST channel",
              body: (
                <>
                  Create a revocable Google App Password for the authorized Gmail account and set
                  <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">GMAIL_APP_PASSWORD</code>. Keep the sender,
                  recipient, and reply-to values exactly aligned with the documented hard-coded identities. Restart the server after changing
                  configuration. SAFE TEST reaches one authorized inbox only; it does not validate customer sending.
                </>
              ),
            },
            {
              title: "Invite staff and assign roles",
              body: (
                <>
                  Use <Link href="/admin/users" className="font-semibold text-sky-700 hover:underline">Users</Link> to add staff. Managers
                  can operate content and reviews; administrators manage accounts and infrastructure views. Give every person an individual
                  account, require the first-login password change, deactivate departed users promptly, and never share an account.
                </>
              ),
            },
            {
              title: "Run acceptance checks",
              body: (
                <>
                  Run <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">npm run lint</code>,
                  <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">npm run typecheck</code>,
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">npm test</code>, and
                  <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">npm run build</code>. Database tests must use
                  the separately guarded <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">TEST_DATABASE_URL</code> ending
                  in <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">_test</code>; they must never target operational data.
                </>
              ),
            },
          ].map((step, index) => (
            <Card key={step.title} className="p-5">
              <div className="flex gap-4">
                <StepNumber>{index + 1}</StepNumber>
                <div>
                  <h3 className="font-bold text-slate-900">{step.title}</h3>
                  <p className="mt-1 text-sm leading-7 text-slate-700">{step.body}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5">
          <h3 className="font-bold text-rose-950">Stop at internal activation</h3>
          <p className="mt-2 text-sm leading-relaxed text-rose-900">
            Do not set <code className="font-mono text-xs">PRODUCTION_DELIVERY_ENABLED=true</code>.
            The complete customer-dispatch workflow, scheduler, lifecycle enforcement,
            operational deployment, and reporting are not finished. AXIS must also resolve
            the explicit-consent business and legal policy before real customer delivery is
            implemented or enabled. The environment switch is a last-line guard, not a
            feature-completion button.
          </p>
          {isAdmin ? (
            <Link href="/admin/email-infrastructure" className={`${buttonSecondary} mt-4`}>
              Inspect email infrastructure
            </Link>
          ) : null}
        </div>
      </section>

      <section id="first-login" className="scroll-mt-6">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">First login for staff</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card className="p-5">
            <h3 className="font-bold text-slate-900">1. Replace the temporary password</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Sign in with the administrator-provided credentials. The platform restricts
              the account to the password-change page until the temporary password is replaced.
              Use a unique password and never send it through email or chat.
            </p>
          </Card>
          <Card className="p-5">
            <h3 className="font-bold text-slate-900">2. Confirm your role and test banner</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Your role appears beside your name. The amber Test mode banner should remain
              visible. Missing administrator menus usually means the account is a Manager;
              it does not mean the server authorization can be bypassed.
            </p>
          </Card>
        </div>
      </section>

      <section id="workflow" className="scroll-mt-6">
        <p className="text-sm font-bold uppercase tracking-wide text-sky-700">Staff guide</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
          Complete newsletter workflow
        </h2>
        <ol className="mt-5 space-y-4">
          {workflow.map((step, index) => (
            <li key={step.title}>
              <Card className="p-5">
                <div className="flex gap-4">
                  <StepNumber>{index + 1}</StepNumber>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-slate-900">{step.title}</h3>
                    <p className="mt-1 text-sm leading-7 text-slate-700">{step.body}</p>
                    <Link href={step.href} className="mt-2 inline-block text-sm font-semibold text-sky-700 hover:underline">
                      {step.action} →
                    </Link>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section id="safety" className="scroll-mt-6">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Rules that must never be bypassed</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {[
            ["Customer delivery", "No current screen or workaround is authorized to send real customer email."],
            ["Consent and opt-out", "DENIED consent always excludes an address. UNKNOWN means consent is unconfirmed and currently produces a readiness warning, not an exclusion; AXIS must settle the explicit-consent policy before real customer delivery."],
            ["Four eyes", "No campaign creator, including an Administrator, may approve their own production audience. Rejection requires a reason."],
            ["Live eligibility", "An approved audience describes the past; eligibility must be re-read immediately before dispatch."],
            ["No duplicate retry", "Do not retry an uncertain submission. Check provider evidence first."],
            ["Secrets", "Keep tokens, passwords, database URLs, webhook secrets, and Cloudinary credentials out of Git and the browser."],
            ["CRM ownership", "Fix CRM master facts in Monday.com. Never add a platform write-back shortcut."],
            ["Public links", "Production unsubscribe and web-version links require a stable public HTTPS origin, never localhost."],
          ].map(([title, body]) => (
            <Card key={title} className="p-5">
              <div className="flex gap-3">
                <span aria-hidden className="text-lg text-emerald-600">✓</span>
                <div>
                  <h3 className="font-bold text-slate-900">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{body}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section id="faq" className="scroll-mt-6">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Frequently asked questions</h2>
        <p className="mt-2 text-sm text-slate-600">Open a question to see the full answer.</p>
        <div className="mt-4 space-y-3">
          {faqs.map((faq) => (
            <details key={faq.question} className="group rounded-xl border border-slate-200 bg-white shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-600">
                {faq.question}
                <span aria-hidden className="text-xl text-slate-400 transition group-open:rotate-45">+</span>
              </summary>
              <p className="border-t border-slate-100 px-5 py-4 text-sm leading-7 text-slate-700">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="support" className="scroll-mt-6 rounded-xl bg-slate-900 p-6 text-white">
        <h2 className="text-xl font-bold">Still need help?</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
          Record the page, the action you attempted, the time, and the exact non-secret
          error message. Do not include passwords, API keys, tokens, full database URLs,
          customer exports, or unsubscribe links. For an uncertain email submission,
          state that clearly and do not try again.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/" className={buttonPrimary}>Return to dashboard</Link>
          <a href="mailto:info@axis-gps.com" className={buttonSecondary}>Contact AXIS</a>
        </div>
      </section>
    </div>
  );
}
