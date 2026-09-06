# Operational tooling

Host-facing configuration, startup validation, health checks, migration manifests and encrypted
database backups. These tools contain no campaign, CRM or email business workflow. The application
uses services/repositories for its runtime health and authentication decisions.

See [the runbook](../docs/operations.md) for deployment, secret handling, recovery and scaling.
`container-smoke.mjs` owns disposable synthetic Docker resources and never loads `.env`.
Run `npm run ops:test` for configuration/encryption tests and `npm run ops:smoke` after building
the runner, migrator, backup and worker images. PostgreSQL remains the only shared state service.

`worker.mjs` is a thin authenticated tick client; job selection and every business decision
remain in server services. `npm run ops:benchmark` adds synthetic capacity measurements
to the disposable rehearsal. See [workflow operations](../docs/workflow-operations.md)
and [capacity evidence](../docs/capacity.md).
