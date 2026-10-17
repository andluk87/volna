FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY tests ./tests
COPY shared ./shared
COPY scripts ./scripts
COPY compose*.yaml ./
COPY docker ./docker
COPY client/public/sw.js ./client/public/sw.js
CMD ["npm", "test"]
