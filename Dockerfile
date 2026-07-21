FROM node:22-bookworm-slim AS build

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    APP_HOST=0.0.0.0 \
    APP_PORT=3000 \
    ALLOW_NETWORK_BIND=true \
    DATA_ROOT=/data \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg tini \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data \
  && chown -R node:node /data
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start"]
