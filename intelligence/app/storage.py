from functools import lru_cache
import base64
import hashlib
import boto3
from botocore.config import Config
from .config import settings
from . import cost_guard


@lru_cache
def session():
    return boto3.Session(profile_name=settings.aws_profile, region_name=settings.aws_region)


@lru_cache
def _s3_client():
    return session().client(
        "s3",
        config=Config(
            connect_timeout=5, read_timeout=30, retries={"max_attempts": 2, "mode": "standard"}
        ),
    )


def s3():
    if not cost_guard.permitted():
        raise cost_guard.FreePlanRequiredError()
    return _s3_client()


def diagnostics():
    client = s3()
    client.head_bucket(Bucket=settings.s3_bucket)
    region = (
        client.get_bucket_location(Bucket=settings.s3_bucket)["LocationConstraint"] or "us-east-1"
    )
    public = None
    note = None
    try:
        flags = client.get_public_access_block(Bucket=settings.s3_bucket)[
            "PublicAccessBlockConfiguration"
        ]
        public = all(flags.values()) and len(flags) == 4
    except client.exceptions.ClientError:
        note = "Public access block could not be inspected with this identity."
    return {
        "connected": True,
        "bucket": settings.s3_bucket,
        "region": region,
        "region_matches": region == settings.aws_region,
        "public_access_blocked": public,
        "note": note,
    }


def upload(key, data, mime, file_id):
    s3().put_object(
        Bucket=settings.s3_bucket,
        Key=key,
        Body=data,
        ContentType=mime,
        ServerSideEncryption="AES256",
        Metadata={"cloudvault-id": file_id},
        IfNoneMatch="*",
        ChecksumSHA256=base64.b64encode(hashlib.sha256(data).digest()).decode(),
    )


def read(key):
    result = s3().get_object(Bucket=settings.s3_bucket, Key=key)
    try:
        if result["ContentLength"] > settings.max_upload_mb * 1024 * 1024:
            raise ValueError("Object exceeds configured processing limit")
        return result["Body"].read(settings.max_upload_mb * 1024 * 1024 + 1)
    finally:
        result["Body"].close()


def delete(key):
    if not key.startswith(settings.s3_object_prefix):
        raise ValueError("Only application-owned objects can be deleted")
    s3().delete_object(Bucket=settings.s3_bucket, Key=key)
