# Multi-stage build. @libsql/client is pure JS (no native compilation) so
# Alpine or any slim image works fine — no build toolchain needed.

FROM node:22-bookworm-slim AS builder
WORKDIR /app

# puppeteer is a devDependency used only by local capture-*.js tooling
# scripts, which never run inside this container — skip its ~300MB Chromium
# download entirely.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# VITE_* vars get baked into the frontend bundle at build time (Vite reads
# import.meta.env.VITE_* while running `vite build` below) — they're NOT
# read at runtime the way every other env var in this app is. Render (or any
# Docker-based host) only makes dashboard env vars available to `RUN npm run
# build` if this Dockerfile explicitly declares them as build ARGs and
# re-exposes them as ENV — without this block, setting VITE_SENTRY_DSN etc.
# in the Render dashboard would silently do nothing, because the value never
# reaches this build stage at all.
ARG VITE_SENTRY_DSN=""
ARG VITE_POSTHOG_KEY=""
ARG VITE_POSTHOG_HOST=""
ARG VITE_TURNSTILE_SITE_KEY=""
ARG VITE_PADDLE_CLIENT_TOKEN=""
ARG VITE_PADDLE_ENV=""
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN} \
    VITE_POSTHOG_KEY=${VITE_POSTHOG_KEY} \
    VITE_POSTHOG_HOST=${VITE_POSTHOG_HOST} \
    VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY} \
    VITE_PADDLE_CLIENT_TOKEN=${VITE_PADDLE_CLIENT_TOKEN} \
    VITE_PADDLE_ENV=${VITE_PADDLE_ENV}

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop devDependencies (vite, etc.) now that the build is done, so the
# runtime image below only inherits production node_modules.
RUN npm prune --omit=dev

# ── Runtime image ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd -r app && useradd -r -g app app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/public       ./public
COPY server.js tickers.js scanner.js monitor.js backup.js ./
COPY server ./server
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# In production (Render + Turso) no local SQLite file is used.
# The data/ dir is still created so local dev (file:./data/users.db) works.
RUN mkdir -p data logs && chown -R app:app /app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Stays root here — entrypoint.sh re-chowns the volume mount (which arrives
# root-owned at container start, undoing the chown above) before dropping
# to the unprivileged "app" user to actually run the server.
CMD ["./entrypoint.sh"]
