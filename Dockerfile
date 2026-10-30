# The self-hosted server: web app + sync API on one port, vaults stored as files in /data.
#
#   docker build -t open-ed-web .
#   docker run -p 8787:8787 -v open-ed-web-data:/data open-ed-web
#
# Add -e COURSE_STORAGE=on to also store course archives, so devices can download
# courses from the server instead of importing the .zip on each one.
#
# Put it behind HTTPS (see docs/self-hosting.md); browsers only allow the storage the app
# needs on https:// or localhost.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm run build:server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/api/v1/health >/dev/null || exit 1
CMD ["node", "server-dist/node.mjs"]
