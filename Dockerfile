FROM node:18-alpine AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:18-alpine AS build

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npm run build

FROM node:18-alpine AS deploy

WORKDIR /app

ENV NODE_ENV production

COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/.next ./.next

EXPOSE 3000

CMD ["npm", "start"]

# Install additional tools (curl and grep)
RUN apk --no-cache add curl grep

# Healthcheck
HEALTHCHECK --interval=30s --timeout=1s --start-period=3s --retries=1 \
  CMD curl -s http://127.0.0.1:3000/api/healthz | grep -qm1 ok
