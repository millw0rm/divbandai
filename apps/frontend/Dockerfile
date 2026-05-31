# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /workspace
ENV NODE_ENV=development

COPY package.json ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY packages/auth/package.json packages/auth/package.json

RUN npm install --workspaces --include-workspace-root

FROM dependencies AS build
ARG DIVBAND_API_BASE_URL=/api
ENV DIVBAND_API_BASE_URL=${DIVBAND_API_BASE_URL}

COPY apps/frontend apps/frontend

RUN node apps/frontend/scripts/build.mjs

FROM node:22-bookworm-slim AS runtime
WORKDIR /app/apps/frontend

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

COPY apps/frontend/package.json ./package.json
COPY apps/frontend/scripts/serve.mjs scripts/serve.mjs
COPY --from=build /workspace/apps/frontend/dist dist

RUN chown -R node:node /app
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "scripts/serve.mjs"]
