# syntax=docker/dockerfile:1

# =============================================================================
# Bonaire Patacona — Nuxt 4 (Nitro node-server)
#
# Works as-is on Dokploy, Dockhand, Coolify, CapRover or plain `docker run`.
# The image is self-contained: only runtime env vars are needed (see .env.example).
# =============================================================================

# ----------------------------------------------------------------------------
# 1. Dependencies
# ----------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
ENV NUXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc ./
# `postinstall` runs `nuxt prepare`, which needs the whole project. It is skipped
# here on purpose: `nuxt build` regenerates .nuxt anyway.
RUN npm ci --ignore-scripts

# ----------------------------------------------------------------------------
# 2. Build
# ----------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
ENV NUXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# @nuxtjs/supabase resolves these at build time. They are placeholders: the real
# values are injected at runtime through NUXT_PUBLIC_SUPABASE_URL / _KEY.
ARG SUPABASE_URL=http://localhost:8000
ARG SUPABASE_KEY=build-time-placeholder
ENV SUPABASE_URL=$SUPABASE_URL
ENV SUPABASE_KEY=$SUPABASE_KEY

RUN npm run build

# ----------------------------------------------------------------------------
# 3. Runtime
# ----------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache tini wget \
  && addgroup -g 1001 -S nodejs \
  && adduser -S nuxt -u 1001 -G nodejs

ENV NODE_ENV=production \
    NUXT_TELEMETRY_DISABLED=1 \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=nuxt:nodejs /app/.output ./.output

USER nuxt
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
