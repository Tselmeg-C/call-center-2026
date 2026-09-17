#!/bin/sh
# Self-check for #62: every `uses:` action reference in this directory's workflow
# files must resolve to a full 40-char commit SHA (not a mutable tag like @v4),
# carrying a trailing human-readable version comment, and the Railway CLI install
# in ci.yml must be pinned to an exact version rather than a floating major.
#
# Usage: .github/workflows/test-pinned-actions.sh   (run from anywhere)
set -eu

dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
fail=0

echo "==> Checking no 'uses:' line is pinned to a mutable @vN tag"
if grep -rE '@v[0-9]' "$dir"/*.yml; then
  echo "Found a mutable @vN tag above -- every 'uses:' ref must be a full commit SHA" >&2
  fail=1
else
  echo "    none found"
fi

echo "==> Checking every 'uses:' ref is a 40-char SHA with a version comment"
# Local reusable workflows (`uses: ./...`) live in this repo and can't be SHA-pinned.
uses_lines=$(grep -rnE '^\s*-?\s*uses:' "$dir"/*.yml | grep -vE 'uses:\s*\./')
tmp_uses=$(mktemp)
printf '%s\n' "$uses_lines" > "$tmp_uses"
while IFS= read -r line; do
  [ -n "$line" ] || continue
  ref=$(printf '%s' "$line" | sed -E 's/.*uses:\s*[^@]+@([0-9a-f]{40}).*/\1/')
  case "$line" in
    *"$ref"*'#'*)
      : # has a trailing comment
      ;;
    *)
      echo "Missing trailing version comment: $line" >&2
      fail=1
      ;;
  esac
  if ! printf '%s' "$ref" | grep -qE '^[0-9a-f]{40}$'; then
    echo "Not a 40-char commit SHA: $line" >&2
    fail=1
  fi
done < "$tmp_uses"
rm -f "$tmp_uses"

echo "==> Checking Railway CLI install is pinned to an exact version"
railway_line=$(grep -E 'npm install -g @railway/cli@' "$dir"/ci.yml)
if printf '%s' "$railway_line" | grep -qE '@railway/cli@[0-9]+\.[0-9]+\.[0-9]+'; then
  echo "    $railway_line"
else
  echo "Railway CLI install is not pinned to an exact x.y.z version: $railway_line" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "==> Pinned-actions check FAILED"
  exit 1
fi
echo "==> Pinned-actions check passed"
