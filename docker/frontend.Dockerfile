FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
# npm ci needs every workspace manifest to validate the lockfile, even the
# ones we don't install (-w limits the install to frontend + shared).
COPY packages/shared/package.json packages/shared/
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/package.json apps/backend/
RUN npm ci -w @fice/frontend -w @fice/shared --include=dev --no-audit --no-fund --legacy-peer-deps
COPY packages ./packages
COPY apps/frontend ./apps/frontend
ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE \
  NEXT_TELEMETRY_DISABLED=1 \
  NODE_OPTIONS=--max-old-space-size=4096
WORKDIR /app/apps/frontend
RUN npm run build

# `output: 'standalone'` traces only the files the server needs: a single
# `node server.js` instead of `npx next start` (an extra npm process) on top
# of the whole monorepo node_modules.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3001 \
  HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/apps/frontend/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=build --chown=app:app /app/apps/frontend/public ./apps/frontend/public
USER app
EXPOSE 3001
CMD ["node", "apps/frontend/server.js"]
