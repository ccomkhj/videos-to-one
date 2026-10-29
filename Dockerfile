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
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# Debian's ffmpeg has libx264, libx265, libfreetype (drawtext) and libzimg (zscale).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core fonts-noto-cjk tzdata \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    FONT_LATIN=/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf \
    FONT_CJK=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/server server
COPY --from=build /app/web/package.json web/package.json
COPY --from=build /app/web/dist web/dist
VOLUME /data
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "server/src/main.ts"]
