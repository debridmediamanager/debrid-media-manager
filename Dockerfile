# Use the same base image for all stages
FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Dependencies stage - this will cache node_modules
FROM base AS deps
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# Local packages that package.json installs with file:
COPY vendor ./vendor
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Lint runs beside the build rather than before it (npm's prebuild), which
# took ~180 s of a 330 s build. The deploy stage copies its marker, so a lint
# failure still fails the image.
FROM base AS lint
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run lint && touch /lint-passed

# Build stage
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next.config.js points webpack's cache at node_modules/.cache; keep it between builds.
# standalone moves out of .next so the deploy stage does not copy it twice (~500 MB).
RUN --mount=type=cache,target=/app/node_modules/.cache \
    --mount=type=cache,target=/app/.next/cache \
    npx prisma generate && npx next build && mv .next/standalone /standalone

# Deploy stage
FROM base AS deploy
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
# All of .next, not only static: it holds server chunks and manifests standalone leaves out.
COPY --from=build /app/.next ./.next
COPY --from=build /standalone .
COPY --from=lint /lint-passed /tmp/lint-passed
RUN apt-get update && apt-get install -y curl grep && rm -rf /var/lib/apt/lists/*
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -sf -m 5 http://localhost:3000/api/healthz | grep -qm1 ok
