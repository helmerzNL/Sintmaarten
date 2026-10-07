FROM node:22-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=9888
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node:node /data
# Versie en commit van deze build (door de GitHub Action meegegeven)
ARG APP_VERSION=dev
ARG GIT_SHA=onbekend
ENV APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA
VOLUME /data
EXPOSE 9888
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/api/auth/status >/dev/null || exit 1
# Start als root alleen om de rechten op /data te herstellen; de app zelf draait als gebruiker "node".
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
