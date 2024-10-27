# Use the same base image for all stages
FROM node:18-alpine AS base
WORKDIR /app

# Dependencies stage
FROM base AS dependencies
COPY package*.json ./
RUN npm ci

# Build stage
FROM base AS build
COPY --from=dependencies /app/node_modules ./node_modules
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
COPY --from=build /app/.next/standalone .
RUN apk --no-cache add curl grep
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]

# Healthcheck
HEALTHCHECK --interval=30s --timeout=1s --start-period=3s --retries=1 \
  CMD curl -s http://localhost:3000/api/healthz | grep -qm1 ok
