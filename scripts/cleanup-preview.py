"""Bounded read-only preservation/cleanup preview. There is deliberately no apply option."""

from pathlib import Path
import json
import sqlite3
import sys
from datetime import datetime, timezone
import numpy as np
from dotenv import load_dotenv

root = Path(__file__).resolve().parents[1]
load_dotenv(root / ".env")
sys.path.insert(0, str(root / "intelligence"))
from app import cloud, cost_guard, storage  # noqa: E402
from app.config import settings  # noqa: E402

if not cost_guard.permitted():
    raise SystemExit(
        "No cloud audit: current approved account/Free plan/reserve could not be verified"
    )
cfg = cloud.configuration()
report = {
    "observed_at": datetime.now(timezone.utc).isoformat(),
    "read_only": True,
    "deletion_authorized": False,
    "proposed_deletions": [],
    "preserve_existing_stack": True,
}
objects = []
request = {
    "Bucket": settings.s3_bucket,
    "Prefix": settings.s3_object_prefix,
    "MaxKeys": 100,
}
for _ in range(3):
    result = storage.s3().list_objects_v2(**request)
    objects.extend(result.get("Contents", []))
    if not result.get("IsTruncated"):
        break
    request["ContinuationToken"] = result["NextContinuationToken"]
else:
    raise RuntimeError("Managed object audit exceeded bounded 300-object limit")
report["managed_original_objects"] = len(objects)
report["managed_original_bytes"] = sum(o["Size"] for o in objects)
for label, prefix in [("file_metadata_rows", "FILE#"), ("workflow_rows", "JOB#")]:
    count = 0
    request = {
        "TableName": cfg["table"],
        "KeyConditionExpression": "pk=:pk AND begins_with(sk,:prefix)",
        "ExpressionAttributeValues": {
            ":pk": {"S": "WORKSPACE#default"},
            ":prefix": {"S": prefix},
        },
        "Select": "COUNT",
        "Limit": 100,
    }
    for _ in range(3):
        result = cloud.client("dynamodb").query(**request)
        count += result["Count"]
        if not result.get("LastEvaluatedKey"):
            break
        request["ExclusiveStartKey"] = result["LastEvaluatedKey"]
    else:
        raise RuntimeError("Metadata audit exceeded bounded 300-row limit")
    report[label] = count
scope = {"vectorBucketName": cfg["vector_bucket"], "indexName": cfg["vector_index"]}
listed = cloud.client("s3vectors").list_vectors(**scope, maxResults=100)
report["vector_keys_first_page"] = len(listed.get("vectors", []))
report["vector_listing_truncated"] = bool(listed.get("nextToken"))
legacy = root / ".private-backup/cloudvault.db"
if legacy.exists():
    with sqlite3.connect(legacy.as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        rows = [dict(row) for row in db.execute("SELECT * FROM chunks")]
        original_keys = {row[0] for row in db.execute("SELECT object_key FROM files")}
    current_keys = {o["Key"] for o in objects}
    report["legacy_originals_present"] = len(original_keys & current_keys)
    report["legacy_originals_missing"] = len(original_keys - current_keys)
    expected = {cloud.vector_key(row): row for row in rows}
    if expected and len(expected) <= 100:
        found = (
            cloud.client("s3vectors")
            .get_vectors(
                **scope, keys=list(expected), returnData=True, returnMetadata=True
            )
            .get("vectors", [])
        )
        exact = 0
        for vector in found:
            row = expected.get(vector["key"])
            if row and np.array_equal(
                np.frombuffer(row["vector"], dtype=np.float32),
                np.asarray(vector["data"]["float32"], dtype=np.float32),
            ):
                exact += 1
        report["legacy_vectors_expected"] = len(expected)
        report["legacy_vectors_byte_equivalent"] = exact
report["note"] = (
    "All existing objects/resources are protected. Metadata counts include tombstones and historical workflow tests. No contents, credentials or private names are exported."
)
(root / ".runtime/cleanup-preview.json").write_text(
    json.dumps(report, indent=2), encoding="utf-8"
)
(root / "docs/PRESERVATION_CLOUD_AUDIT.json").write_text(
    json.dumps(report, indent=2), encoding="utf-8"
)
print(json.dumps(report, indent=2))
