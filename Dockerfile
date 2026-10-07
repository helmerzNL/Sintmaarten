FROM node:22-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=9888
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 9888
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/api/auth/status >/dev/null || exit 1
CMD ["node", "server/index.js"]
