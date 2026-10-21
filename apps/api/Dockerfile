# ScopeLock API — production image.
# Build from the repository root so npm workspaces resolve:
#   docker build -f apps/api/Dockerfile .
# Or use the compose stack: docker compose up --build
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /srv/scopelock

# Prisma's query engine needs OpenSSL at generate and run time; slim omits it.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Manifests first for layer caching (every workspace manifest must exist for `npm ci`).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
# --ignore-scripts: root postinstall needs the full source tree, so it runs after COPY.
RUN npm ci --include=dev --ignore-scripts

COPY . .
# Generate the Prisma client BEFORE compiling the API: npm ci ran with
# --ignore-scripts, so @prisma/client is still the empty stub and
# `tsc` would fail with "has no exported member 'PrismaClient'".
RUN npm run prisma:generate \
  && npm run build -w packages/domain \
  && npm run build -w packages/contracts \
  && npm run build -w apps/api

EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrate on every deploy (docs/OPERATIONS.md §8), then serve. Single replica
# only: concurrent migrate-deploy from several replicas can race.
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node apps/api/dist/index.js"]
