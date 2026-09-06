# Unfinished workflows — completion report

Validated 2026-09-05. This report covers the five requested gaps. Existing workspace UI
and hosted-foundation changes were preserved. Nothing was committed or deployed.

## 1. Executive summary

Implemented durable scheduled work, authenticated Monday webhooks, explicitly gated
customer dispatch, delivery/engagement reports and a reproducible capacity benchmark.
Operations and Reports expose actual persisted status with responsive screens and
server-enforced authorization. Customer delivery remains disabled by default.

## 2. Repository changes

Completion work added or updated these paths; paths are relative to the repository root.
The inventory includes existing foundation files extended by these workflows.

```text
.dockerignore
.env.example
.github/workflows/ci.yml
AGENTS.md
Dockerfile
README.md
package.json
package-lock.json
tsconfig.workflows.json
vitest.config.mts
docs/architecture.md
docs/development-plan.md
docs/requirements.md
docs/testing.md
docs/operations.md
docs/workflow-operations.md
docs/capacity.md
docs/capacity-benchmark-2026-09-05.json
docs/completion-report.md
docs/decisions/README.md
docs/decisions/0035-durable-workflows-customer-dispatch-and-reporting.md
ops/README.md
ops/capacity-benchmark.mjs
ops/compose.yaml
ops/container-smoke.mjs
ops/hosted.env.example
ops/runtime-config.mjs
ops/runtime-config.test.mjs
ops/worker.env.example
ops/worker.mjs
ops/worker.test.mjs
prisma/schema.prisma
prisma/migrations/20260905210000_durable_workflows/migration.sql
src/proxy.ts
src/app/layout.tsx
src/app/api/internal/jobs/tick/route.ts
src/app/api/webhooks/monday/route.ts
src/app/api/webhooks/resend/route.ts
src/app/api/reports/[id]/export/route.ts
src/app/newsletters/[id]/dispatchActions.ts
src/app/newsletters/[id]/readiness/page.tsx
src/app/operations/actions.ts
src/app/operations/page.tsx
src/app/reports/page.tsx
src/app/reports/[id]/page.tsx
src/domain/campaign/lifecycle.ts
src/domain/campaign/sendReadiness.ts
src/domain/campaign/sendReadiness.test.ts
src/domain/delivery/customerEnvelope.ts
src/domain/delivery/providerEvent.ts
src/domain/delivery/reporting.ts
src/domain/delivery/reporting.test.ts
src/domain/jobs/README.md
src/domain/jobs/policy.ts
src/server/auth/session.ts
src/server/db/migration-manifest.json
src/server/db/repositories/audienceRepository.ts
src/server/db/repositories/campaignRepository.ts
src/server/db/repositories/jobRepository.ts
src/server/integrations/crm/index.ts
src/server/integrations/crm/mondayWebhook.ts
src/server/integrations/email/productionEmailProvider.ts
src/server/integrations/email/resendProductionEmailProvider.ts
src/server/integrations/email/resendProductionEmailProvider.test.ts
src/server/jobs/README.md
src/server/jobs/context.ts
src/server/services/automationService.ts
src/server/services/boundedRequest.ts
src/server/services/boundedRequest.test.ts
src/server/services/campaignAudienceService.ts
src/server/services/crmSyncService.ts
src/server/services/deliveryService.ts
src/server/services/jobService.ts
src/server/services/mondayWebhookService.ts
src/server/services/newsletterDraftService.ts
src/server/services/newsletterService.ts
src/server/services/productionDispatchService.ts
src/server/services/providerEventService.ts
src/server/services/providerWebhookService.ts
src/server/services/reportService.ts
src/server/services/runtimeStatusService.ts
src/server/services/segmentService.ts
src/server/services/sendReadinessService.ts
src/ui/AppShell.tsx
src/ui/CustomerDeliveryControls.tsx
src/ui/DeliveryMetrics.tsx
src/ui/OperationsControls.tsx
src/ui/ReadinessActions.tsx
e2e/specs/01-authenticated-render.spec.ts
e2e/specs/03-responsive.spec.ts
e2e/specs/07-workflows.spec.ts
tests/integration/completedWorkflows.int.test.ts
tests/integration/consent.int.test.ts
tests/integration/delivery.int.test.ts
tests/integration/providerWebhook.int.test.ts
tests/integration/sendReadiness.int.test.ts
```

## 3. Architecture decisions

[ADR-0035](decisions/0035-durable-workflows-customer-dispatch-and-reporting.md) records
PostgreSQL jobs, per-resource claims, staff delegation, bounded retries, Monday signature
verification, frozen customer-message approval, immediate eligibility vetoes and exact
provider-event correlation. PostgreSQL meets the measured internal workload without
another queue service. The separate customer method preserves the pilot/test envelopes.
UNKNOWN consent remains a planning warning but blocks actual delivery authorization.
Resend acceptance never becomes confirmed delivery without the provider's delivery event.

## 4. Commands executed

```sh
npm run test:db:migrate
npm run db:generate
npm run db:validate
npm run ops:manifest
npm run ops:manifest:check
npm run lint
npm run typecheck
npm run typecheck:workflows
npm test
npm run ops:test
npm run e2e
docker build --target runner -t axis-ccp:ops-foundation-local .
docker build --target migrator -t axis-ccp:ops-migrator-local .
docker build --target worker -t axis-ccp:ops-worker-local .
docker build --target backup -t axis-ccp:ops-backup-local .
npm run ops:benchmark
git diff --check
```

The guarded migration command changed only `axis_ccp_test`. Container rehearsals applied
all 18 migrations to their own disposable databases. The E2E command built Next.js and
prepared the standalone server against the guarded test database. The final Docker
runner build includes the last queue-lock fix; its worker rehearsal exercised that fix.

## 5. Validation results

| Check | Final result |
|---|---|
| Build | PASS — Next.js production/standalone build and all four Docker targets |
| Typecheck | PASS — application and workflow integration project |
| Lint | PASS |
| Tests | PASS — 1,435 Vitest tests across 80 files; 11 operational Node tests |
| Browser | PASS — 82 Playwright checks across desktop/mobile |
| Schema and migration manifest | PASS |
| Container operations | PASS — worker, two replicas, database recovery, encrypted restore |
| Capacity | PASS — 540 requests, zero errors; [measurements](capacity.md) |
| Diff whitespace | PASS |
| Hosted CI run / live external integrations | NOT RUN — no push, deployment or live provider calls |

The new integration coverage includes typed confirmation, unknown consent, immutable
content, revoked approvals/reviews, post-scheduling unsubscribe, mid-batch CRM changes,
uncertain network outcomes, concurrent attempts, duplicate/early/orphan provider events,
pilot isolation, job lease forgery, actor revocation, overlapping resources, missed
windows and signed Monday notifications. Screenshots of Operations and Reports were
visually reviewed. Earlier validation failures were corrected; the results above are
the final runs. Logs remain in `var/completion-*.log` and screenshots in `test-results/`.

## 6. Assumptions and open questions

This remains one internal AXIS platform with Monday as its read-only CRM source.
Operators must provide the hosting/DNS/secrets, signed Monday app subscriptions,
Resend domain setup, offsite backup/alerts and service-level targets. Documented consent
must exist before customer delivery. The runbook explains these configuration steps.

## 7. Risks and technical debt

The benchmark is short and local; hosted capacity, failover and a sustained soak remain
deployment measurements. If the provider outcome is uncertain and no message id was
persisted, the attempt stays uncertain for manual provider investigation and is never
automatically retried. Engagement depends on observed provider events and privacy tools.
Old production approvals need renewed review because the production sender/message are
now hashed explicitly. No existing approval silently authorizes the new message.

## 8. Current project state

All five requested implementation gaps are complete and validated locally. Customer
delivery and live Monday intake are not activated. No live email, Monday registration,
DNS mutation or operational data migration occurred. The operational database still
requires the release migration before running these new workflows against it.
Use [workflow operations](workflow-operations.md) and [hosted operations](operations.md)
for the release sequence; there is no automatic migration or activation at app startup.

## 9. Recommended next task

Configure and rehearse the hosted staging release with the deployment operator.
