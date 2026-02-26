#!/usr/bin/env sh
set -eu

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
echo "Latest run:"
gh run list --workflow docker-publish.yml --limit 1
echo
echo "Watch with:"
echo "gh run watch \$(gh run list --workflow docker-publish.yml --limit 1 \\"
echo "  --json databaseId --jq '.[0].databaseId')"
