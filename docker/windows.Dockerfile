FROM node:24-bookworm-slim
WORKDIR /app
COPY shared/ /shared/
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates libstdc++6 zlib1g && rm -rf /var/lib/apt/lists/*
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 CSC_IDENTITY_AUTO_DISCOVERY=false ELECTRON_BUILDER_COMPRESSION_LEVEL=5
COPY client/package*.json ./
COPY client/index.html client/vite.config.js ./
COPY client/src/ ./src/
COPY client/native/ ./native/
COPY client/electron/ ./electron/
COPY client/scripts/ ./scripts/
COPY client/public/boot.js client/public/manifest.webmanifest client/public/appearance-sample.wav ./public/
COPY client/public/icons/ ./public/icons/
COPY client/public/demo/ ./public/demo/
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN node -e "if(!/^https:\/\//.test(process.env.VITE_API_URL || '')) throw Error('Set VITE_API_URL=https://your-server in .env')"
CMD ["sh", "scripts/docker-windows-build.sh"]
