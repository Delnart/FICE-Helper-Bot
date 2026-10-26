FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
# npm ci needs every workspace manifest to validate the lockfile, even the
# ones we don't install (-w limits the install to backend + shared).
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci -w @fice/backend -w @fice/shared --no-audit --no-fund --legacy-peer-deps
COPY packages ./packages
COPY apps/backend ./apps/backend
WORKDIR /app/apps/backend
RUN npx nest build

# Production-only dependencies: no nest cli / webpack / typescript / jest in
# the image the 1 GB VPS has to pull and keep on disk.
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci -w @fice/backend -w @fice/shared --omit=dev --no-audit --no-fund --legacy-peer-deps \
  && npm cache clean --force

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Alpine ships without tzdata, so `TZ=Europe/Kyiv` would silently fall back to
# UTC and our "now lesson" calc would be 3 hours off.
RUN apk add --no-cache tzdata \
  && cp /usr/share/zoneinfo/Europe/Kyiv /etc/localtime \
  && echo "Europe/Kyiv" > /etc/timezone
ENV TZ=Europe/Kyiv
RUN addgroup -S app && adduser -S app -G app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/package.json ./package.json
USER app
EXPOSE 3000
WORKDIR /app/apps/backend
# Heap cap is set per environment via NODE_OPTIONS (see docker-compose.prod.yml).
CMD ["node", "dist/main.js"]
