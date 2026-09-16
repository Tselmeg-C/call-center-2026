#!/bin/sh
# Container-run smoke check for #32: builds both images, starts them against
# infra/docker-compose.test.yml's Postgres, and confirms /health/ready and
# the frontend's index page. No credentials are printed.
#
# Usage: infra/smoke-test.sh   (run from the repository root)
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

compose_test="infra/docker-compose.test.yml"
api_image="call-center-api:smoke"
frontend_image="call-center-frontend:smoke"
api_port=18000
frontend_port=18080
db_url="postgresql+psycopg://postgres@127.0.0.1:55432/call_center_test"

cleanup() {
  docker rm -f smoke-api smoke-frontend >/dev/null 2>&1 || true
  docker compose -f "$compose_test" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Building images"
docker build -q -f apps/api/Dockerfile -t "$api_image" . >/dev/null
docker build -q -f apps/frontend/Dockerfile -t "$frontend_image" . >/dev/null

echo "==> Starting test Postgres ($compose_test)"
docker compose -f "$compose_test" up -d postgres

echo "==> Waiting for Postgres to be healthy"
i=0
until [ "$(docker inspect --format='{{.State.Health.Status}}' "$(docker compose -f "$compose_test" ps -q postgres)")" = "healthy" ]; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "Postgres did not become healthy in time" >&2
    exit 1
  fi
  sleep 1
done

# --network host so the API container can reach the test Postgres published
# on 127.0.0.1:55432 without relying on inter-container bridge networking.
echo "==> Starting API container"
docker run -d --network host --name smoke-api \
  -e CALL_CENTER_STORAGE=postgres \
  -e DATABASE_URL="$db_url" \
  -e FRONTEND_ORIGIN=http://localhost:4174 \
  -e PORT="$api_port" \
  -e WEB_CONCURRENCY=1 \
  "$api_image" >/dev/null

echo "==> Starting frontend container"
docker run -d --network host --name smoke-frontend \
  -e PORT="$frontend_port" \
  -e API_UPSTREAM="127.0.0.1:${api_port}" \
  "$frontend_image" >/dev/null

# #27 QA regression: the /api/ proxy hung and 504'd live because API_UPSTREAM is a hostname
# (Railway private-network domain) that nginx used to resolve once at startup and cache for the
# life of the worker -- after the API service redeploys and gets a new private IP, the frontend
# silently kept proxying to the dead old one. The fix (default.conf.template's `resolver` +
# variable-based proxy_pass) can't be exercised with this script's IP-literal API_UPSTREAM above
# (a literal IP never goes through resolution at all), so just confirm the rendered config still
# has the resolver mechanism wired up -- NGINX_LOCAL_RESOLVERS actually substituted, not left as
# a literal unresolved "${NGINX_LOCAL_RESOLVERS}" placeholder.
echo "==> Checking frontend nginx has a resolver directive wired up (#27)"
resolver_line=$(docker exec smoke-frontend grep -E '^\s*resolver ' /etc/nginx/conf.d/default.conf || true)
case "$resolver_line" in
  *'${NGINX_LOCAL_RESOLVERS}'*|"")
    echo "Frontend nginx config is missing a substituted resolver directive: '$resolver_line'" >&2
    exit 1
    ;;
esac
echo "    $resolver_line"

echo "==> Waiting for /health/ready"
i=0
until curl -fsS "http://127.0.0.1:${api_port}/health/ready" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "API did not become ready in time" >&2
    docker logs smoke-api >&2 || true
    exit 1
  fi
  sleep 1
done
echo "    /health/ready: $(curl -fsS "http://127.0.0.1:${api_port}/health/ready")"

echo "==> Checking frontend index page"
frontend_status=$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${frontend_port}/")
if [ "$frontend_status" != "200" ]; then
  echo "Frontend did not serve index page (HTTP $frontend_status)" >&2
  exit 1
fi
echo "    frontend index: HTTP $frontend_status"

echo "==> Checking frontend's /api/ reverse proxy reaches the real API (#27)"
proxied=$(curl -fsS "http://127.0.0.1:${frontend_port}/api/health/ready")
if [ "$proxied" != "$(curl -fsS "http://127.0.0.1:${api_port}/health/ready")" ]; then
  echo "Frontend /api/ proxy did not return the API's /health/ready body" >&2
  exit 1
fi
echo "    frontend /api/health/ready: $proxied"

echo "==> Smoke check passed"
