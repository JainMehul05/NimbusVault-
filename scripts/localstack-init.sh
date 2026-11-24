#!/bin/sh
# LocalStack ready hook: create the development bucket and its CORS rule (idempotent).
awslocal s3api head-bucket --bucket nimbusvault 2>/dev/null || awslocal s3 mb s3://nimbusvault
awslocal s3api put-bucket-cors --bucket nimbusvault --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:5173", "http://localhost:4173"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"]
  }]
}'
awslocal s3api put-bucket-lifecycle-configuration --bucket nimbusvault --lifecycle-configuration '{
  "Rules": [{ "ID": "staging", "Status": "Enabled", "Filter": { "Prefix": "staging/" }, "Expiration": { "Days": 1 } }]
}' || true
