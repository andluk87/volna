FROM node:24-trixie-slim
ENV NODE_ENV=production DB_PATH=/data/volna.db UPLOAD_PATH=/data/uploads PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node scripts/migrate-postgres.mjs ./scripts/migrate-postgres.mjs
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000 8998
CMD ["node", "server/index.mjs"]
