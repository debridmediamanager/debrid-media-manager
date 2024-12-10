# Use the same base image for all stages
FROM node:latest AS base
WORKDIR /app

# Dependencies stage - this will cache node_modules
FROM base AS deps
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Build stage
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# Deploy stage
FROM base AS deploy
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/.next/static ./.next/static
# Copy the entire .next directory to ensure PWA files are included
COPY --from=build /app/.next ./.next
COPY --from=build /app/.next/standalone .
RUN apt-get update && apt-get install -y curl grep && rm -rf /var/lib/apt/lists/*
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]

# Healthcheck
HEALTHCHECK --interval=30s --timeout=1s --start-period=3s --retries=1 \
  CMD curl -s http://localhost:3000/api/healthz | grep -qm1 ok
