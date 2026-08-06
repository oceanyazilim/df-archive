# Virus Records license panel — production image for Dokploy.
#
# Multi-stage: deps → build → tiny runtime carrying only Next's standalone
# output. Licence data lives in /data, which MUST be a mounted volume — a
# container rebuild would otherwise take every issued key with it.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATA_DIR=/data

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 \
  && mkdir -p /data && chown -R nextjs:nodejs /data

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
VOLUME ["/data"]

# The standalone build emits its own minimal server.
CMD ["node", "server.js"]
