# Use a single stage for dependencies and build, as they share the same base image
FROM node:18-alpine AS build

# Install additional tools (curl and grep) only once
RUN apk --no-cache add curl grep

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source files
COPY . .

# Generate prisma client and build the project
RUN npx prisma generate && npm run build

# Set environment variables for the deploy stage
ENV NODE_ENV production
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# Copy only necessary files for the deploy stage
FROM node:18-alpine AS deploy
WORKDIR /app
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/.next/standalone .

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=1s --start-period=3s --retries=1 \
  CMD curl -s http://localhost:3000/api/healthz | grep -qm1 ok

CMD ["node", "server.js"]
