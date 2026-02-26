#!/usr/bin/env sh
set -eu

TAG="${1:-latest}"
REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_REPO="${IMAGE_REPO:-shadow}"
LOCAL_IMAGE="${LOCAL_IMAGE:-shadow-local:latest}"
DOCKERFILE="${DOCKERFILE:-docker/Dockerfile}"
PLATFORM="${PLATFORM:-linux/amd64}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is required."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is required."
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: gh is not authenticated. Run: gh auth login"
  exit 1
fi

OWNER="$(gh repo view --json owner --jq '.owner.login')"
if [ -z "${OWNER}" ] || [ "${OWNER}" = "null" ]; then
  echo "Error: could not resolve repository owner."
  exit 1
fi

TARGET_IMAGE="${REGISTRY}/${OWNER}/${IMAGE_REPO}"
GIT_SHA="$(git rev-parse --short=12 HEAD)"

if docker image inspect "${LOCAL_IMAGE}" >/dev/null 2>&1; then
  echo "Using existing local image: ${LOCAL_IMAGE}"
else
  echo "Local image not found. Building locally..."
  docker build --platform "${PLATFORM}" -f "${DOCKERFILE}" -t "${LOCAL_IMAGE}" .
fi

CIRCUIT_ID="$(
  docker run --rm --platform "${PLATFORM}" --entrypoint cat "${LOCAL_IMAGE}" /tmp/circuit-id.txt \
    | tr -d '[:space:]'
)"
if [ -z "${CIRCUIT_ID}" ]; then
  echo "Error: failed to extract circuit ID from ${LOCAL_IMAGE}"
  exit 1
fi

AUTH_USER="$(gh api user --jq '.login')"
if [ -z "${AUTH_USER}" ] || [ "${AUTH_USER}" = "null" ]; then
  echo "Error: could not resolve authenticated GitHub username."
  exit 1
fi

echo "Logging in to ${REGISTRY} as ${AUTH_USER}..."
gh auth token | docker login "${REGISTRY}" -u "${AUTH_USER}" --password-stdin >/dev/null

echo "Tagging image:"
echo "  ${TARGET_IMAGE}:${TAG}"
echo "  ${TARGET_IMAGE}:${GIT_SHA}"
echo "  ${TARGET_IMAGE}:${CIRCUIT_ID}"
docker tag "${LOCAL_IMAGE}" "${TARGET_IMAGE}:${TAG}"
docker tag "${LOCAL_IMAGE}" "${TARGET_IMAGE}:${GIT_SHA}"
docker tag "${LOCAL_IMAGE}" "${TARGET_IMAGE}:${CIRCUIT_ID}"

echo "Pushing tags to ${REGISTRY}..."
docker push "${TARGET_IMAGE}:${TAG}"
docker push "${TARGET_IMAGE}:${GIT_SHA}"
docker push "${TARGET_IMAGE}:${CIRCUIT_ID}"

echo
echo "Published image: ${TARGET_IMAGE}"
echo "Tags:"
echo "  - ${TAG}"
echo "  - ${GIT_SHA}"
echo "  - ${CIRCUIT_ID}"
