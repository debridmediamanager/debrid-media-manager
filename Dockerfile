FROM node:16-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:16-alpine as production
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY --from=builder /app/.next ./.next
COPY ./public ./public
ENV NODE_ENV=production
EXPOSE 3000
CMD [ "npm", "start" ]
