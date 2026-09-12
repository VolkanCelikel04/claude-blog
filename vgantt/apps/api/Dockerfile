# Multi-stage: build with dev dependencies, ship without them.
FROM node:22-alpine AS build
WORKDIR /srv

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY packages/vault-core/package.json packages/vault-core/
RUN npm ci --workspace @vgantt/api --include-workspace-root

COPY apps/api apps/api
RUN npm run build --workspace @vgantt/api

FROM node:22-alpine AS runtime
WORKDIR /srv
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @vgantt/api --include-workspace-root --omit=dev \
 && npm cache clean --force

COPY --from=build /srv/apps/api/dist apps/api/dist

# Never run as root; the API needs no filesystem write access of its own.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
