# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /workspace
ENV NODE_ENV=development

COPY package.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/auth/package.json packages/auth/package.json

RUN npm install --workspaces --include-workspace-root

FROM dependencies AS build
COPY tsconfig.json ./
COPY apps/backend apps/backend
COPY packages/auth packages/auth
COPY packages/mcp-server packages/mcp-server
COPY packages/agent-skill packages/agent-skill

RUN npm run build --workspace @divband/backend

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    KUBERNETES_TEMPLATE_DIR=/app/infra/k8s/base

COPY package.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/auth/package.json packages/auth/package.json
RUN npm install --omit=dev --workspaces --include-workspace-root \
  && npm cache clean --force

COPY --from=build /workspace/apps/backend/src apps/backend/src
COPY --from=build /workspace/apps/backend/migrations apps/backend/migrations
COPY --from=build /workspace/apps/backend/openapi.yaml apps/backend/openapi.yaml
COPY --from=build /workspace/packages/auth/src packages/auth/src
COPY infra/k8s/base infra/k8s/base

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL "https://dl.k8s.io/release/$(curl -fsSL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" -o /usr/local/bin/kubectl \
  && chmod +x /usr/local/bin/kubectl \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/apps/backend/data && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "run", "start", "--workspace", "@divband/backend"]
