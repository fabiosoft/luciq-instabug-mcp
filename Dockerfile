# Multi-stage build: compile TypeScript with full deps, run with prod-only deps.
FROM node:22-alpine AS builder
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --include=dev
COPY tsconfig.json ./
COPY src ./src
COPY api ./api
COPY functions ./functions
RUN npx tsc -p tsconfig.json

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info \
    CORS_ORIGINS="*"
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist ./dist

RUN mkdir -p /data && chown -R node:node /app /data
USER node
WORKDIR /data

EXPOSE 8080
# REST API at /, MCP streamable-HTTP at /mcp.
# Override CMD to run the stdio MCP server or the one-shot CLI:
#   command: ["node", "/app/dist/src/bin/mcp-stdio.js"]
#   entrypoint: ["node", "/app/dist/src/cli.js"]
CMD ["node", "/app/dist/src/bin/serve.js"]
