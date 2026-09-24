# syntax=docker/dockerfile:1
# Multi-stage build for apps/frontend: build the static bundle with Node,
# then serve it with nginx (no Node runtime in the final image).
#
# Build (from repo root, so the build context includes the workspace lockfile):
#   docker build -f apps/frontend/Dockerfile -t call-center-frontend .
# Run (Railway/containers inject $PORT; default to 8080 locally):
#   docker run --rm -p 8080:8080 -e PORT=8080 call-center-frontend

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm ci

COPY apps/frontend apps/frontend
# VITE_SERVICE_MODE is a Vite *build-time* value (baked into the static bundle, see
# src/services/provider.tsx) -- a deployed image must never fall back to the in-memory mock
# adapter, so this is fixed here rather than left to a Railway runtime env var.
ENV VITE_SERVICE_MODE=http
RUN npm run build --workspace @call-center/frontend

FROM nginx:1.30-alpine@sha256:985220252f3863977e468f611ef118ebd01421289dd86ee1ae99cb068c3bce2b AS runtime

COPY apps/frontend/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html

ENV PORT=8080
# host:port of the API service, substituted into the nginx template at container start
# (nginx's own envsubst entrypoint step, so this stays a runtime value unlike VITE_SERVICE_MODE
# above). Railway sets this per-environment via a variable reference, e.g.
# API_UPSTREAM=${{api.RAILWAY_PRIVATE_DOMAIN}}:8000 -- see _docs/deployment.md. The default here
# only matters for a local `docker run`.
ENV API_UPSTREAM=localhost:8000
# Turns on the base image's built-in /docker-entrypoint.d/15-local-resolvers.envsh, which reads
# the container's own nameserver(s) from /etc/resolv.conf into $NGINX_LOCAL_RESOLVERS before the
# envsubst templating step runs -- used by default.conf.template's `resolver` directive so the
# /api/ proxy re-resolves API_UPSTREAM instead of caching whatever it resolved to at nginx
# startup (see comment there for why that caching is the actual bug, not just a hardening nice-to-have).
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
EXPOSE 8080
