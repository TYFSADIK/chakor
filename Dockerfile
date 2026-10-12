# syntax=docker/dockerfile:1
# Build once, run anywhere Docker runs: Linux, macOS, Windows.

# ---- deps: install node modules (needs build tools for better-sqlite3) ----
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# ---- build: compile the Next.js app ----
FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- run: small runtime image (non-root) ----
FROM node:20-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    CHAKOR_DB_PATH=/data/chakor.db \
    CHAKOR_MODELS_DIR=/data/models \
    CHAKOR_WORKSPACE=/data/workspaces \
    CHAKOR_PYTHON=/app/.venv/bin/python
# Agent Workspace runs Python (docx/pptx/charts) through scripts/sandbox-runner.py.
# Give the runtime its own venv so the host's python is never needed. The venv
# stays root-owned on purpose: the app (and sandboxed code) only reads it.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /app/.venv \
    && /app/.venv/bin/pip install --no-cache-dir python-docx python-pptx matplotlib pandas
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/next.config.mjs ./next.config.mjs
# Only the scripts the server actually runs: DB init and the sandbox runner.
COPY --from=build --chown=node:node /app/scripts/init-db.mjs ./scripts/init-db.mjs
COPY --from=build --chown=node:node /app/scripts/sandbox-runner.py ./scripts/sandbox-runner.py
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN mkdir -p /data/models && chown -R node:node /data && chmod +x docker-entrypoint.sh
USER node
EXPOSE 3001
VOLUME ["/data"]
# node:20-slim has no wget/curl, so use the runtime's own fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
