FROM node:24-bookworm-slim
ENV NODE_ENV=production DB_PATH=/data/volna.db PORT=3000
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000 8998
CMD ["node", "server/index.mjs"]
