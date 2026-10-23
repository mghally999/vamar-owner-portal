# syntax=docker/dockerfile:1.7
#
# Self-hosted image of the API + dashboard (the same code that runs on Cloudflare Workers, served
# by the Node server in apps/api/src/dev-server.ts with a plain Postgres). Used by docker-compose
# for a full local stack and as a fallback host. Production runs on Workers.
#
#   docker build -t vamar-portal .
#   docker compose up --wait          (Postgres + Auth emulator + migrations/seed + this image)

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /app

# Dependencies for the API, the dashboard and the database package only (not the mobile app).
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/tokens/package.json packages/tokens/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter "@vamar/api..." --filter "@vamar/dashboard..." --filter "@vamar/db..."

# Dashboard build. DASHBOARD_MODE=development points it at the Auth emulator (compose);
# production needs apps/dashboard/.env.production with the Firebase web config.
FROM deps AS build
ARG DASHBOARD_MODE=development
COPY . .
RUN pnpm --filter @vamar/dashboard exec vite build --mode ${DASHBOARD_MODE}

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api ./apps/api
COPY --from=build --chown=node:node /app/apps/dashboard/dist ./apps/dashboard/dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8787/readyz || exit 1
CMD ["node", "--import", "tsx", "apps/api/src/dev-server.ts"]
