# Stage 1: Install Dependencies
FROM node:alpine AS dependencies
WORKDIR /app

# Install build dependencies
COPY package.json package-lock.json ./
RUN npm ci --production

# Stage 2: Build the Application
FROM node:alpine AS build
WORKDIR /app

# Copy dependencies from the previous stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy the rest of the application code
COPY . .

# Generate Prisma client and build the Next.js application
RUN npx prisma generate && npm run build

# Stage 3: Prepare the Production Image
FROM node:alpine AS deploy
WORKDIR /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Install runtime dependencies
RUN apk --no-cache add curl

# Copy the standalone build from the build stage
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

# Healthcheck to ensure the application is running
HEALTHCHECK --interval=30s --timeout=1s --start-period=3s --retries=1 \
  CMD curl -f http://localhost:3000/api/healthz || exit 1

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
