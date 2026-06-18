# comforceEva — production image (Fastify API serving the built React web app)
# Build context = the platform/ monorepo root.

# ── build stage ──────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
# manifests first for layer caching
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN corepack pnpm@9.0.0 install --no-frozen-lockfile
RUN corepack pnpm@9.0.0 -r build

# ── runtime stage ────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
# poppler-utils provides `pdftotext`, used by the study-upload endpoint
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
ENV NODE_ENV=production
# built workspace (packages/*/dist, apps/api/dist, apps/web/dist) + node_modules
COPY --from=build /app /app

# Azure Container Apps / App Service inject the port; 8080 is the convention
ENV PORT=8080
ENV HOST=0.0.0.0
# PHI lives on a mounted volume, NEVER in the image
ENV STUDIES_DIR=/data/studies
EXPOSE 8080

CMD ["node", "apps/api/dist/index.js"]
