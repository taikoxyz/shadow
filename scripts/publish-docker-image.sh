#!/usr/bin/env sh
set -eu

# Force plain output; avoid paging/interactive terminal modes.
export GH_PAGER=cat
export PAGER=cat

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is required."
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: gh is not authenticated. Run: gh auth login"
  exit 1
fi

TAG="${1:-dev}"
REF="${2:-main}"

echo "Dispatching docker publish workflow..."
echo "ref=${REF} tag=${TAG}"

gh workflow run docker-publish.yml --ref "${REF}" -f "tag=${TAG}"

echo
RUN_ID="$(gh run list --workflow docker-publish.yml --limit 1 \
  --json databaseId --jq '.[0].databaseId')"

if [ -n "${RUN_ID}" ] && [ "${RUN_ID}" != "null" ]; then
  echo "Latest run: https://github.com/taikoxyz/shadow/actions/runs/${RUN_ID}"
  echo "Watch with: gh run watch ${RUN_ID}"
fi
