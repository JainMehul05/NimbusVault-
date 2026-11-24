#!/usr/bin/env bash
# Deploys IMAGE_TAG: migrate the database, roll the services, publish the site.
# Also performs the very first deployment, and is how you roll back (pass an older IMAGE_TAG).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
: "${IMAGE_TAG:?Set IMAGE_TAG to an image already in ECR}"

REPOSITORY="$(output "$FOUNDATION" RepositoryUri)"
[ -n "$REPOSITORY" ] || { echo "Deploy the foundation first: infra/scripts/bootstrap.sh" >&2; exit 1; }
aws ecr describe-images --repository-name "${REPOSITORY#*/}" --image-ids "imageTag=$IMAGE_TAG" >/dev/null

if [ -z "$(output "$PLATFORM" ClusterName)" ]; then
  log "First deployment: creating the platform with no running tasks"
  cdk_run deploy "$PLATFORM" --require-approval never -c "imageTag=$IMAGE_TAG" -c desiredCount=0
fi

log "Running database migrations from image $IMAGE_TAG"
CLUSTER="$(output "$PLATFORM" ClusterName)"
TASK_DEF="$(output "$PLATFORM" MigrationTaskArn)"
# Same task, new image: migrations must be applied before any new code serves traffic.
REVISION="$(aws ecs describe-task-definition --task-definition "${TASK_DEF%:*}" --query taskDefinition --output json |
  jq --arg image "$REPOSITORY:$IMAGE_TAG" '.containerDefinitions[0].image = $image
    | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)')"
TASK_DEF="$(aws ecs register-task-definition --cli-input-json "$REVISION" --query taskDefinition.taskDefinitionArn --output text)"
TASK="$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$TASK_DEF" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$(output "$PLATFORM" MigrationSubnets)],securityGroups=[$(output "$PLATFORM" MigrationSecurityGroup)],assignPublicIp=ENABLED}" \
  --query 'tasks[0].taskArn' --output text)"
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
CODE="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)"
if [ "$CODE" != 0 ]; then
  echo "Migration failed (exit $CODE); the running version was not changed." >&2
  aws logs filter-log-events --log-group-name "$(output "$PLATFORM" MigrationLogGroup)" \
    --log-stream-names "migrate/app/${TASK##*/}" --query 'events[].message' --output text >&2 || true
  exit 1
fi

log "Deploying services (ECS rolls back automatically if new tasks are unhealthy)"
cdk_run deploy "$PLATFORM" --require-approval never -c "imageTag=$IMAGE_TAG"

log "Publishing the web app"
npm run build --workspace=frontend --prefix "$ROOT"
SITE="$(output "$PLATFORM" SiteBucketName)"
# New hashed assets first and old ones kept (bucket versioning, pages already open); then the
# entry point, so no visitor ever sees an index that refers to missing files.
aws s3 sync "$ROOT/frontend/dist" "s3://$SITE" --exclude index.html --cache-control 'public,max-age=31536000,immutable'
for f in favicon.svg robots.txt; do
  aws s3 cp "$ROOT/frontend/dist/$f" "s3://$SITE/$f" --cache-control 'public,max-age=3600'
done
aws s3 cp "$ROOT/frontend/dist/index.html" "s3://$SITE/index.html" --cache-control 'no-cache'
aws cloudfront create-invalidation --distribution-id "$(output "$PLATFORM" DistributionId)" --paths /index.html /favicon.svg /robots.txt >/dev/null

log "Live at $(output "$PLATFORM" SiteUrl) (image $IMAGE_TAG)"
