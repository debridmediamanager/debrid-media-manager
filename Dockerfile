FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV production
COPY ./package*.json .
COPY ./prisma/schema.prisma .
COPY ./public .
COPY ./.next .
RUN npm ci && npx prisma generate
EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"
CMD ["node", "server.js"]
# Combine RUN instructions and install packages
RUN apk --no-cache add curl grep
# Healthcheck as before
HEALTHCHECK --interval=30s --timeout=1s --start-period=3s --retries=1 \
  CMD curl -s http://localhost:3000/api/healthz | grep -qm1 ok
