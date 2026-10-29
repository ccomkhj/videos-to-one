# videos-to-one: local app, phone uploads over Wi-Fi, one long video out (SPEC §3, §6.1).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web
# Orientation-detection models (~82 MB, sha256-checked); sideways-clip suggestions need them.
RUN npm run models
RUN npm run build && npm prune --omit=dev \
 && rm -rf node_modules/onnxruntime-node/bin/napi-v6/darwin node_modules/onnxruntime-node/bin/napi-v6/win32

FROM node:22-bookworm-slim
# Debian's ffmpeg has libx264, libx265, libfreetype (drawtext) and libzimg (zscale).
# VA drivers are for VAAPI with `--device /dev/dri` (Intel/AMD); whether a GPU encoder
# is usable is decided by a test encode at startup, with software as the fallback.
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core fonts-noto-cjk tzdata mesa-va-drivers \
    $([ "$TARGETARCH" = amd64 ] && echo intel-media-va-driver) \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    ORT_DISABLE_TELEMETRY=1 \
    FONT_LATIN=/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf \
    FONT_CJK=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/server server
COPY --from=build /app/web/package.json web/package.json
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/models models
VOLUME /data
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "server/src/main.ts"]
