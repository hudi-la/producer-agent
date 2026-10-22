# Match the existing production Node runtime and preserve Claude's PTY login.
# Render's native image does not include expect; installing at build time avoids
# privileged runtime installs or storing system dependencies on the user disk.
FROM node:24.9.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git openssh-client rsync expect python3 ripgrep sqlite3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY brain/package.json brain/package-lock.json ./brain/
RUN npm ci --prefix brain --omit=dev --no-audit --no-fund
COPY . .
# Only public browser configuration is compiled into Vite. Server credentials
# are injected by Render at runtime and must never be declared as build args.
ARG VITE_HOSTED=1
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/brain ./brain
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /home/node/.ssh && chown node:node /home/node/.ssh && chmod 700 /home/node/.ssh
USER node
CMD ["node", "scripts/start-render.mjs"]
