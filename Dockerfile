# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --include=dev
RUN npx prisma generate

FROM dependencies AS builder
COPY . .
ARG AXIS_DEPLOYMENT_ID
ENV AXIS_DEPLOYMENT_ID=${AXIS_DEPLOYMENT_ID}
RUN node ops/migration-manifest.mjs --check && npm run build

# An explicit one-off tool image. The application never migrates on startup.
FROM dependencies AS migrator
COPY ops/migrate.mjs ops/runtime-config.mjs ./ops/
USER node
ENTRYPOINT ["node", "ops/migrate.mjs"]

FROM postgres:16-alpine AS backup
RUN apk add --no-cache nodejs
WORKDIR /tools
COPY ops/database-backup.mjs ops/backup-lib.mjs ./
USER postgres
ENTRYPOINT ["node", "database-backup.mjs"]

FROM node:24-bookworm-slim AS worker
WORKDIR /worker
COPY ops/worker.mjs ops/runtime-config.mjs ./
USER node
ENTRYPOINT ["node", "worker.mjs"]

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node ops/start.mjs ops/runtime-config.mjs ops/check-health.mjs ./ops/
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=4s --start-period=30s --retries=3 CMD ["node", "ops/check-health.mjs"]
ENTRYPOINT ["node", "ops/start.mjs"]
