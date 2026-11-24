#!/usr/bin/env bash
# Builds the backend image and pushes it to ECR. Immutable tags: an existing tag is reused.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
: "${IMAGE_TAG:?Set IMAGE_TAG (normally the git commit SHA)}"

REPOSITORY="$(output "$FOUNDATION" RepositoryUri)"
[ -n "$REPOSITORY" ] || { echo "Deploy the foundation first: infra/scripts/bootstrap.sh" >&2; exit 1; }

if aws ecr describe-images --repository-name "${REPOSITORY#*/}" --image-ids "imageTag=$IMAGE_TAG" >/dev/null 2>&1; then
  log "Image $IMAGE_TAG already exists"
  exit 0
fi

log "Building $REPOSITORY:$IMAGE_TAG"
aws ecr get-login-password | docker login --username AWS --password-stdin "${REPOSITORY%%/*}"
docker build --platform linux/amd64 -f "$ROOT/backend/Dockerfile" -t "$REPOSITORY:$IMAGE_TAG" "$ROOT"
docker push "$REPOSITORY:$IMAGE_TAG"
