FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY shared/ /shared/
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build
FROM nginx:1.28-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# Validate syntax during build without requiring Compose upstream DNS.
RUN cp /etc/nginx/conf.d/default.conf /tmp/volna-runtime.conf \
 && sed -i 's|http://server:3000|http://127.0.0.1:3000|g' /etc/nginx/conf.d/default.conf \
 && nginx -t \
 && mv /tmp/volna-runtime.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
