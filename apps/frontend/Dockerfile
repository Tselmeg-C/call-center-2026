# syntax=docker/dockerfile:1
# Multi-stage build for apps/frontend: build the static bundle with Node,
# then serve it with nginx (no Node runtime in the final image).
#
# Build (from repo root, so the build context includes the workspace lockfile):
#   docker build -f apps/frontend/Dockerfile -t call-center-frontend .
# Run (Railway/containers inject $PORT; default to 8080 locally):
#   docker run --rm -p 8080:8080 -e PORT=8080 call-center-frontend

FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm ci

COPY apps/frontend apps/frontend
RUN npm run build --workspace @call-center/frontend

FROM nginx:1.27-alpine AS runtime

COPY apps/frontend/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html

ENV PORT=8080
EXPOSE 8080
