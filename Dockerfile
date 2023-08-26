# ---- Base Node ----
FROM node:14-alpine AS base
WORKDIR /app
COPY package*.json ./

# ---- Dependencies ----
FROM base AS dependencies
RUN npm set progress=false && npm config set depth 0
RUN npm install --only=production
# copy production node_modules aside
RUN cp -R node_modules prod_node_modules
# install ALL node_modules, including 'devDependencies'
RUN npm install

# ---- Build ----
FROM dependencies AS build
COPY . .
RUN npm run build

# --- Release ----
FROM base AS release
# copy production node_modules
COPY --from=dependencies /app/prod_node_modules ./node_modules
# copy app sources
COPY . .
# copy build files from build image
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# Expose the listening port
EXPOSE 3000
CMD ["npm", "start"]
