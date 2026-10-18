# syntax=docker/dockerfile:1

# Alpine keeps the image small. @node-rs/argon2 ships musl prebuilds, so no
# native toolchain is needed for the password hashing in #9.
FROM node:24-alpine AS base
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
CMD ["npm", "run", "dev"]

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
