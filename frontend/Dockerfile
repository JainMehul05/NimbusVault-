# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f frontend/Dockerfile -t nimbusvault-frontend .
# Serves the static app and proxies /api, for Docker Compose and other non-AWS hosts.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY e2e/package.json e2e/
COPY infra/package.json infra/
RUN npm ci --workspace=frontend --include-workspace-root=false
COPY frontend frontend
RUN npm run build --workspace=frontend

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
ENV API_UPSTREAM=http://backend:3000
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
