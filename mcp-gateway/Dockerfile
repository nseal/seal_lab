# node:22-slim (glibc) so better-sqlite3 can use its prebuilt binaries.
# Override BASE_IMAGE to pull the Node 22 base from an internal mirror instead
# of Docker Hub: docker build --build-arg BASE_IMAGE=<mirror>/node:22-slim .
ARG BASE_IMAGE=node:22-slim

FROM ${BASE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/admin-ui/package.json packages/admin-ui/
RUN npm ci
COPY packages packages
RUN npm run build

FROM ${BASE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/admin-ui/package.json packages/admin-ui/
RUN npm ci --omit=dev

FROM ${BASE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/package.json .
COPY --from=build /app/packages/server/package.json packages/server/package.json
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/admin-ui/dist packages/admin-ui/dist
# /data is the expected mount point for persistent SQLite storage.
RUN mkdir -p /data && chown node:node /data
ENV MCP_GATEWAY_DB_PATH=/data/gateway.db
USER node
EXPOSE 8787
CMD ["node", "packages/server/dist/index.js"]
