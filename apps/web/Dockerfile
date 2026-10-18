# ScopeLock web client — static build served by nginx.
# Build from the repository root so npm workspaces resolve:
#   docker build -f apps/web/Dockerfile .
# The client talks to the API over same-origin relative /api/* paths, so the
# image needs no build args: nginx proxies /api/ to the API container.
FROM node:22-slim AS build

WORKDIR /srv/scopelock
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci --include=dev --ignore-scripts

COPY . .
RUN npm run build -w packages/domain \
  && npm run build -w packages/contracts \
  && npm run build -w apps/web

FROM nginx:1.27-alpine AS run
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /srv/scopelock/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1
