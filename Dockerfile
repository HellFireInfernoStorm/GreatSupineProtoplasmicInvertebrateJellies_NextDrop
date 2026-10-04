# syntax=docker/dockerfile:1
# NextDrop app image: Fastify API plus the built PWA on one port (spec/overview.md §2.2, platform/deployment.md).
# Debian slim, not Alpine (prisma-rules.md).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Prisma probes for OpenSSL; the slim image lacks it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /repo

FROM base AS build
# Manifests first, so dependency layers are reused when only source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/rules/package.json packages/rules/
# --ignore-scripts skips lefthook's git-hook install (no .git here); no dependency needs a build script.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY . .
# Vite reads VITE_* values when it builds, not when the container starts. This one compiles the quick-login chips
# for the seeded accounts into the login screens (ADR 0031). Compose passes DEMO_MODE here; see .env.example.
ARG VITE_DEMO_MODE=true
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
RUN pnpm --filter @nextdrop/api run db:generate \
 && pnpm --filter @nextdrop/web run build

FROM base AS runtime
ENV NODE_ENV=production \
    TZ=Asia/Colombo \
    PORT=3000 \
    WEB_DIST_DIR=/repo/apps/web/dist
# The whole workspace is kept: the API runs TypeScript through tsx, the rules and contracts packages are source,
# and `prisma migrate deploy` needs the Prisma CLI, a dev dependency (prisma-rules.md).
COPY --from=build --chown=node:node /repo /repo
RUN mkdir -p /var/lib/nextdrop && chown node:node /var/lib/nextdrop
USER node
WORKDIR /repo/apps/api
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["sh", "/repo/docker/entrypoint.sh"]
