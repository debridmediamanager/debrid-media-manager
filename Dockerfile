FROM node:18-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:18-alpine AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:18-alpine AS deploy
WORKDIR /app
ENV NODE_ENV production
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/.next/standalone .
EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"
CMD ["node", "server.js"]
# Combine RUN instructions and install packages
RUN apk --no-cache add curl grep
# Healthcheck as before
HEALTHCHECK --interval=30s --timeout=1s --start-period=3s --retries=1 \
  CMD curl -s http://localhost:3000/api/healthz | grep -qm1 ok
