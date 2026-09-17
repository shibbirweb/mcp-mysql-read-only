# syntax=docker/dockerfile:1.7

# Dependencies including devDependencies, shared by the build and test stages.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS builder
WORKDIR /app
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Built with `--target test`. Kept in this file rather than a separate one so
# the tests always run against the same dependency tree as the release image.
FROM builder AS test
WORKDIR /app
COPY test/ ./test/
# No path argument: the runner discovers *.test.js itself. Passing a directory
# is not supported on every Node 22 patch release and fails as a missing module.
CMD ["node", "--test"]

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/dist ./dist

LABEL org.opencontainers.image.title="mcp-mysql-read-only" \
      org.opencontainers.image.description="Read-only MySQL MCP server with runtime-switchable connections" \
      org.opencontainers.image.source="https://github.com/shibbirweb/mcp-mysql-read-only" \
      org.opencontainers.image.licenses="MIT"

CMD ["node", "dist/index.js"]
