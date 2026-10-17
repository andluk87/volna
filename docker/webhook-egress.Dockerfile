FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends iptables util-linux && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/webhook-egress.mjs ./server/webhook-egress.mjs
COPY docker/webhook-egress-entrypoint.sh /usr/local/bin/webhook-egress-entrypoint
ENTRYPOINT ["sh", "/usr/local/bin/webhook-egress-entrypoint"]
