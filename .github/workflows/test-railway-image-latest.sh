#!/bin/sh
# Check for #155: every `image(...)` source in .railway/railway.ts must be exactly
# ghcr.io/tselmeg-c/call-center-2026-{api,frontend}:latest. CI owns the exact <sha>
# via `railway service source connect --image`; a stale pin in this file (e.g. from
# a fresh `railway config pull`) would roll development back on `railway config apply`.
# Resources without image(...) (Postgres, volumes) are ignored.
#
# Usage: .github/workflows/test-railway-image-latest.sh [file]   (default: repo .railway/railway.ts)
#        .github/workflows/test-railway-image-latest.sh --self-test
set -eu

dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
allowed='^image\("ghcr\.io/tselmeg-c/call-center-2026-(api|frontend):latest"\)$'

# check FILE: print each offending line, exit non-zero if any.
check() {
  bad=0
  hits=$(grep -nE '(^|[^A-Za-z0-9_])image\(' "$1" || true)
  tmp=$(mktemp)
  printf '%s\n' "$hits" > "$tmp"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    # Every image( occurrence on the line, including one not closed on that line.
    for ref in $(printf '%s' "$line" | grep -oE 'image\([^)]*\)?' | tr -d ' '); do
      if ! printf '%s' "$ref" | grep -qE "$allowed"; then
        echo "Image ref must be ghcr.io/tselmeg-c/call-center-2026-{api,frontend}:latest: $line" >&2
        bad=1
        break
      fi
    done
  done < "$tmp"
  rm -f "$tmp"
  return "$bad"
}

if [ "${1:-}" = "--self-test" ]; then
  fail=0
  tmp=$(mktemp)
  # expect PASS|FAIL, label, file content
  expect() {
    printf '%s\n' "$3" > "$tmp"
    if check "$tmp" 2>/dev/null; then got=PASS; else got=FAIL; fi
    if [ "$got" = "$1" ]; then echo "    ok   ($1) $2"; else echo "    BAD  expected $1, got $got: $2" >&2; fail=1; fi
  }
  api='ghcr.io/tselmeg-c/call-center-2026-api'
  pg='  const Postgres = postgres("Postgres", { region: "ams" });'
  echo "==> Self-test"
  expect PASS "both :latest plus non-image resources" "$pg
  source: image(\"$api:latest\"),
  source: image(\"ghcr.io/tselmeg-c/call-center-2026-frontend:latest\"),"
  expect PASS "one service only" "  source: image(\"$api:latest\"),"
  expect PASS "no image() at all" "$pg"
  expect FAIL "full SHA tag" "  source: image(\"$api:6d1f35233a5892760aa344b0f4283fbc14083859\"),"
  expect FAIL "short SHA tag" "  source: image(\"$api:6d1f352\"),"
  expect FAIL "release tag" "  source: image(\"$api:v1.2.0\"),"
  expect FAIL "digest" "  source: image(\"$api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"),"
  expect FAIL "untagged" "  source: image(\"$api\"),"
  expect FAIL "other owner :latest" "  source: image(\"ghcr.io/someone-else/call-center-2026-api:latest\"),"
  expect FAIL "other repo :latest" "  source: image(\"ghcr.io/tselmeg-c/other-api:latest\"),"
  expect FAIL "latest plus stale on one line" "  a: image(\"$api:latest\"), b: image(\"$api:6d1f352\"),"
  expect FAIL "non-literal ref" "  source: image(apiRef),"
  expect FAIL "ref split across lines" "  source: image(
    \"$api:6d1f352\"),"
  rm -f "$tmp"
  if [ "$fail" -ne 0 ]; then echo "==> Self-test FAILED"; exit 1; fi
  echo "==> Self-test passed"
  exit 0
fi

file=${1:-"$dir/../../.railway/railway.ts"}
echo "==> Checking image refs in $file"
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }
if check "$file"; then
  echo "==> Railway image check passed"
else
  echo "==> Railway image check FAILED (see infra/railway.md: reset refs to :latest after 'railway config pull')"
  exit 1
fi
