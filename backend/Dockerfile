# syntax=docker/dockerfile:1
# Build from the repository root (the npm lockfile lives there):
#   docker build -f backend/Dockerfile -t nimbusvault-backend .
# Runs the API by default; use `node dist/worker.js` for the worker and
# `node scripts/migrate.cjs` to apply database migrations.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
# CPU inference only: skip the CUDA download (several hundred MB).
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip ONNXRUNTIME_NODE_INSTALL=skip
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY e2e/package.json e2e/
COPY infra/package.json infra/
COPY backend/prisma backend/prisma

FROM base AS build
RUN npm ci --workspace=backend --include-workspace-root=false
COPY backend backend
RUN cd backend && npx prisma generate && npm run build

FROM base AS production-deps
RUN npm ci --workspace=backend --include-workspace-root=false --omit=dev \
  && cd backend && npx prisma generate && npx prisma --version

# The embedding model is part of the image, so production never downloads anything at runtime.
FROM production-deps AS model
ARG EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
COPY backend/scripts/fetch-model.cjs backend/scripts/
RUN cd backend && node scripts/fetch-model.cjs "${EMBEDDING_MODEL}" /models

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/certs /app/models \
  && curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /app/certs/rds-global-bundle.pem \
  && apt-get purge -y curl && apt-get autoremove -y
ENV NODE_ENV=production \
    PORT=3000 \
    HOME=/tmp \
    AI_LOCAL_MODEL_CACHE_DIR=/app/models \
    AI_LOCAL_ALLOW_DOWNLOAD=false \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    CHECKPOINT_DISABLE=1
WORKDIR /app
COPY --from=production-deps /repo/node_modules ./node_modules
# Workspace-specific packages, when a version could not be hoisted.
COPY --from=production-deps /repo/backend ./
COPY --from=build /repo/backend/dist ./dist
COPY --from=model /models ./models
COPY backend/scripts ./scripts
COPY backend/package.json ./package.json
# Scratch space for uploads; a volume so the root filesystem can be read-only.
VOLUME ["/tmp"]
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD ["node", "scripts/healthcheck.cjs", "http"]
CMD ["node", "dist/main.js"]
