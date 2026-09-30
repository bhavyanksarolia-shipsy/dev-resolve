# Dev Resolve — production image. Private data (config, knowledge, logins, synced code) lives on the /data volume;
# secrets arrive as environment variables. Nothing private is baked into the image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Build needs no secrets; the example config stands in for the private one.
RUN mkdir -p config && cp -n config/projects.example.json config/projects.json && cp -n config/config.env.example config/config.env \
 && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 \
    CODE_ROOT=/data/code DEV_RESOLVE_CONFIG_DIR=/data/config UV_CACHE_DIR=/home/node/.cache/uv
RUN apt-get update && apt-get install -y --no-install-recommends python3 git ca-certificates curl tini postgresql-client \
 && rm -rf /var/lib/apt/lists/* \
 && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh \
 && npm install -g mcp-remote@0.8.7
WORKDIR /app
COPY --from=build --chown=node:node /app ./
# App code reads ./knowledge, ./.auth and ./.logs relative to /app — point them at the volume.
# The public knowledge templates (README, _template, _shared) are kept aside and copied onto the volume at start.
RUN rm -f config/projects.json config/config.env && rm -rf .auth .logs \
 && mv knowledge /app/knowledge-defaults \
 && ln -s /data/knowledge /app/knowledge && ln -s /data/auth /app/.auth && ln -s /data/logs /app/.logs \
 && mkdir -p /data && chown node:node /data
USER node
# Warm the Python dependencies of the log server so the first investigation doesn't download them.
RUN uv run --script mcp/opensearch-logs/server.py --help >/dev/null 2>&1 || true
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD curl -fsS http://127.0.0.1:3000/api/healthz || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "bash", "scripts/docker-entrypoint.sh"]
