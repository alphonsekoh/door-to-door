# syntax=docker/dockerfile:1

# Alpine keeps the image small. @node-rs/argon2 ships musl prebuilds, so no
# native toolchain is needed for the password hashing in #9.
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------- deps
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ----------------------------------------------------------------- dev
# Source is bind-mounted at runtime, so this stage only carries dependencies.
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
# Not npm run dev, which binds 127.0.0.1: inside a container that is the
# container's own loopback, which a published port never reaches. Compose
# publishes 3000 on the host's 127.0.0.1 only, so this stays off the LAN.
# The installed binary, not npx, which fetches a missing package from the
# registry: without node_modules this fails instead of running unpinned code.
CMD ["node_modules/.bin/next", "dev", "-H", "0.0.0.0"]

# ----------------------------------------------------------------- e2e
# CI's "End-to-end smoke" job on this machine (scripts/e2e-linux.sh, #201).
# Not part of the app's image: built only with --target e2e, and kept above
# builder so that runner stays the last stage, the one a plain docker build
# builds. CI runs on ubuntu-latest (24.04) with Node 24 and installs the
# browsers with `playwright install --with-deps`; this stage does the same, so
# its WebKit is Linux WebKit and draws in DejaVu Sans as CI's does (R-182),
# which macOS never shows. ubuntu moves with CI's ubuntu-latest, never ahead.
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS e2e-node

FROM ubuntu:24.04@sha256:73b999393d07f2bf65a40373778a44dc9a6d54ad7718d29247d8ff9413c4d6a8 AS e2e
COPY --from=e2e-node /usr/local/ /usr/local/
# As on a GitHub runner. PLAYWRIGHT_HTML_OPEN stops the report from starting a
# server in a container nobody can browse.
ENV CI=true LANG=C.UTF-8 NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_HTML_OPEN=never
WORKDIR /work
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
# CI's runner image has DejaVu already. Here it is named, so fontconfig cannot
# settle on another sans-serif that the browser deps happen to bring.
RUN npx playwright install --with-deps chromium webkit \
  && apt-get install -y --no-install-recommends fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------- builder
FROM base AS builder
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# -------------------------------------------------------------- runner
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
# Standalone output carries only the dependencies actually reached at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migrations only, not their runner: apply them from a checkout or a dev-stage
# container (see README, Deployment).
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

# The settings file is not in the image: mount it read-only, e.g.
#   -v ./config.yaml:/app/config.yaml:ro
# so a change is an edit and a restart, not a rebuild. It must be readable by
# uid 1001. Secrets arrive as DATABASE_USER, DATABASE_PASSWORD, AUTH_SECRET
# (or their _FILE variants).
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0 CONFIG_PATH=/app/config.yaml
CMD ["node", "server.js"]
