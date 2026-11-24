#!/bin/sh
# LocalStack ready hook: create the development bucket (idempotent).
awslocal s3 mb s3://nimbusvault 2>/dev/null || true
