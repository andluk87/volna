FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY tests ./tests
COPY client/public/sw.js ./client/public/sw.js
CMD ["node", "--test", "tests/api.test.mjs", "tests/messaging.test.mjs", "tests/communities.test.mjs", "tests/migration-v02.test.mjs", "tests/profiles.test.mjs", "tests/calls.test.mjs", "tests/push.test.mjs", "tests/push-worker.test.mjs"]
