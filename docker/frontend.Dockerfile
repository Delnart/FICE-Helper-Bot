FROM node:20-alpine AS deps
WORKDIR /app
# Root manifests + lockfile.
COPY package.json package-lock.json* tsconfig.base.json ./
# IMPORTANT: every workspace declared in root package.json must have its
# package.json present at `npm install` time, otherwise npm silently skips
# resolving its dependencies. Missing apps/backend/package.json was causing
# `@types/node` to disappear from the build stage, which made `next build`
# try to install it via yarn at runtime — fails on slow/limited networks.
COPY packages/shared/package.json packages/shared/
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/package.json apps/backend/
RUN npm install --no-audit --no-fund --legacy-peer-deps --include=dev

FROM node:20-alpine AS build
ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
# Tell Next.js: don't try to install missing types — fail loudly if any are
# missing so we catch the regression in CI instead of in a 1000s yarn retry loop.
ENV NEXT_TELEMETRY_DISABLED=1
# 2 GB heap — `next build` peaks around 1.5 GB on this monorepo. Bumping
# higher only wastes laptop RAM (Docker Desktop already grabs 2-3 GB on
# Windows). Images are built locally and pushed to GHCR; the prod VPS never
# sees a build step. If you ever hit a fresh OOM, raise to 3072.
ENV NODE_OPTIONS=--max-old-space-size=8192
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.base.json package.json ./
COPY packages ./packages
COPY apps/frontend ./apps/frontend
# Sanity-check: @types/node must be present before next build, otherwise the
# TypeScript-verification step in `next build` stalls trying to yarn-install it.
RUN test -d /app/node_modules/@types/node \
  || (echo "FATAL: /app/node_modules/@types/node missing — workspace install incomplete" && exit 1)
WORKDIR /app/apps/frontend
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/apps/frontend/.next ./apps/frontend/.next
COPY --from=build /app/apps/frontend/public ./apps/frontend/public
COPY --from=build /app/apps/frontend/package.json ./apps/frontend/package.json
COPY --from=build /app/apps/frontend/next.config.js ./apps/frontend/next.config.js
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./package.json
USER app
EXPOSE 3001
WORKDIR /app/apps/frontend
CMD ["npx", "next", "start", "-p", "3001"]
