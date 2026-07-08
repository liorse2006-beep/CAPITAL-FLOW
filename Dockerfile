# Multi-stage build. Debian-slim (not Alpine) — better-sqlite3 is a native
# module and Alpine's musl libc frequently trips up prebuilt binaries.

FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Native build toolchain for better-sqlite3, isolated to this stage only —
# the final image never carries a compiler.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# puppeteer is a devDependency used only by local capture-*.js tooling
# scripts, which never run inside this container — skip its ~300MB Chromium
# download entirely.
ENV PUPPETEER_SKIP_DOWNLOAD=true

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

# SQLite data + logs live on a volume — not baked into the image.
RUN mkdir -p data logs && chown -R app:app /app

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Stays root here — entrypoint.sh re-chowns the volume mount (which arrives
# root-owned at container start, undoing the chown above) before dropping
# to the unprivileged "app" user to actually run the server.
CMD ["./entrypoint.sh"]
