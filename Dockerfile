# -----------------------------------------------------------------------------
# Stage 1 — builder: install all deps and compile TypeScript
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install pnpm (matches local toolchain)
RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml* package-lock.json* ./
RUN pnpm install --frozen-lockfile || npm install

COPY . .
RUN pnpm run build

# -----------------------------------------------------------------------------
# Stage 2 — runner: production image (Node slim, non-root, prod deps only)
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install pnpm for consistency
RUN npm install -g pnpm@9

RUN groupadd --gid 1001 appgroup \
  && useradd --uid 1001 --gid appgroup --shell /usr/sbin/nologin --create-home appuser

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --ignore-scripts && pnpm store prune

COPY --from=builder /app/dist ./dist

USER appuser

ENV PORT=5000
EXPOSE 5000

# Health check — skipped for worker service (no HTTP server)
# The API service overrides this via railway.toml healthcheckPath
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||5000)+'/health/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Default entry point — bootstrap.ts loads secrets BEFORE server.ts is imported.
# Worker service overrides this with: node dist/worker-bootstrap.js
CMD ["node", "dist/bootstrap.js"]
