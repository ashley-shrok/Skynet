# Stage 1: Install dependencies
FROM node:22-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY .npmrc ./
COPY vendor ./vendor

COPY scripts/patch-guacamole-lite.cjs ./scripts/
COPY scripts/patch-app-builder-lib.cjs ./scripts/
COPY scripts/patch-better-sqlite3.cjs ./scripts/
COPY scripts/patch-nan.cjs ./scripts/

RUN --mount=type=cache,target=/root/.npm npm ci && \
    node scripts/patch-guacamole-lite.cjs && \
    npm cache clean --force

# Stage 2: Build frontend
FROM deps AS frontend-builder
WORKDIR /app

# Phase 111 SKEW-01: propagate the ship-runbook's SKYNET_BUILD_SHA into
# the frontend-builder stage so `vite.config.ts` (which reads
# process.env.VITE_BUILD_ID at config eval time) can bake the byte-stable
# build-id into every bundle via its `define` block. ARG scope resets per
# stage in Docker (Pitfall 3), so this declaration is stage-local and
# MUST be repeated in every downstream stage that reads the value.
ARG SKYNET_BUILD_SHA
ENV VITE_BUILD_ID=${SKYNET_BUILD_SHA:-dev-unknown}

COPY . .

RUN find public/fonts -name "*.ttf" ! -name "*Regular.ttf" ! -name "*Bold.ttf" ! -name "*Italic.ttf" -delete

RUN npm cache clean --force && \
    NODE_OPTIONS="--max-old-space-size=3072" npm run build

# Stage 3: Build backend
FROM deps AS backend-builder
WORKDIR /app

# Phase 111 SKEW-01: declare the ARG in the backend-builder stage too so
# `--build-arg SKYNET_BUILD_SHA=...` propagates through this stage (ARG
# scope resets per stage — Pitfall 3). The tsc compile itself does not
# read the value, but re-declaring keeps the plumbing uniform and lets any
# future stage-3 tooling read it without a surprise "unset" gap.
ARG SKYNET_BUILD_SHA
ENV VITE_BUILD_ID=${SKYNET_BUILD_SHA:-dev-unknown}

COPY . .

RUN npm run build:backend

# Stage 4: Production dependencies only
FROM node:22-slim AS production-deps
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY .npmrc ./
COPY vendor ./vendor

COPY scripts/patch-guacamole-lite.cjs ./scripts/
COPY scripts/patch-app-builder-lib.cjs ./scripts/
COPY scripts/patch-better-sqlite3.cjs ./scripts/
COPY scripts/patch-nan.cjs ./scripts/

RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev && \
    node scripts/patch-guacamole-lite.cjs && \
    (cd node_modules/better-sqlite3 && npx --yes node-gyp rebuild --release) && \
    npm cache clean --force

# Stage 5: Final optimized image
FROM node:22-slim
WORKDIR /app

# Phase 111 SKEW-01: this is where the running Node process reads
# process.env.VITE_BUILD_ID at startup (src/backend/config/server-build-id.ts).
# ARG scope resets per stage in Docker (Pitfall 3) — this declaration is
# load-bearing; drop it and the runtime image will boot with an unset env
# var → SERVER_BUILD_ID falls back to "dev-unknown" → every client sees
# a mismatch → phase-wide reload-loop. See threat T-111-01.
ARG SKYNET_BUILD_SHA

ENV DATA_DIR=/app/data \
    PORT=8080 \
    NODE_ENV=production \
    VITE_BUILD_ID=${SKYNET_BUILD_SHA:-dev-unknown}

RUN apt-get update && apt-get install -y nginx gettext-base openssl ca-certificates gosu wget ffmpeg && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /app/data /app/uploads /app/data/.opk /app/nginx /tmp/nginx /var/log/skynet/console-forward && \
    chown -R node:node /app /tmp/nginx /var/log/skynet && \
    chmod 755 /app/data /app/uploads /app/data/.opk /app/nginx /tmp/nginx /var/log/skynet /var/log/skynet/console-forward

COPY docker/nginx.conf /app/nginx/nginx.conf.template
COPY docker/nginx-https.conf /app/nginx/nginx-https.conf.template

COPY --chown=node:node --from=frontend-builder /app/dist /app/html
COPY --chown=node:node docker/branding-defaults /app/branding-defaults
COPY --chown=node:node docker/pool-defaults /app/pool-defaults
COPY --chown=node:node substrate /app/fleet-substrate

COPY --chown=node:node --from=production-deps /app/node_modules /app/node_modules
COPY --chown=node:node --from=backend-builder /app/dist/backend ./dist/backend
COPY --chown=node:node package.json ./

VOLUME ["/app/data"]

EXPOSE ${PORT} 30001 30002 30003 30004 30005 30006

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:30001/health || exit 1

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
