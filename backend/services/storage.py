import os
import logging

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

# Content types that are accepted for photo uploads
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}

UPLOAD_URL_EXPIRY = 600   # 10 minutes
DOWNLOAD_URL_EXPIRY = 3600  # 1 hour


def _get_s3_client():
    endpoint = os.getenv("S3_ENDPOINT")
    access_key = os.getenv("S3_ACCESS_KEY")
    secret_key = os.getenv("S3_SECRET_KEY")
    region = os.getenv("S3_REGION", "eu-central")

    missing = [
        name for name, val in {
            "S3_ENDPOINT": endpoint,
            "S3_ACCESS_KEY": access_key,
            "S3_SECRET_KEY": secret_key,
        }.items() if not val
    ]
    if missing:
        raise EnvironmentError(
            f"S3 not configured. Missing environment variables: {', '.join(missing)}"
        )

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
        config=boto3.session.Config(signature_version="s3v4"),
    )


def _get_bucket() -> str:
    bucket = os.getenv("S3_BUCKET_NAME")
    if not bucket:
        raise EnvironmentError("S3_BUCKET_NAME not configured.")
    return bucket


def generate_photo_key(category: str, variant: str, photo_uuid: str, extension: str = "jpg") -> str:
    """Return the canonical storage key for a photo variant.

    Format: wedding/{category}/{variant}/{uuid}.{extension}

    Args:
        category:   "guest" or "photographer"
        variant:    "original", "preview", or "thumb"
        photo_uuid: UUID string for the photo
        extension:  file extension without dot (default "jpg").
                    For originals, pass the actual upload extension (e.g. "heic", "png").
                    Preview and thumbnail variants are always "jpg".
    """
    return f"wedding/{category}/{variant}/{photo_uuid}.{extension}"


def get_file_url(key: str) -> str:
    """Return the persistent (non-expiring) public URL for a storage key."""
    endpoint = os.getenv("S3_ENDPOINT", "").rstrip("/")
    bucket = os.getenv("S3_BUCKET_NAME", "")
    return f"{endpoint}/{bucket}/{key}"


def generate_upload_url(key: str, content_type: str) -> str:
    """Generate a pre-signed PUT URL for direct client-to-storage upload.

    Expires after UPLOAD_URL_EXPIRY seconds.
    """
    client = _get_s3_client()
    bucket = _get_bucket()
    url = client.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=UPLOAD_URL_EXPIRY,
    )
    logger.info("Generated upload URL for key=%s", key)
    return url


def generate_download_url(key: str) -> str:
    """Generate a pre-signed GET URL for downloading a file.

    Expires after DOWNLOAD_URL_EXPIRY seconds.
    """
    client = _get_s3_client()
    bucket = _get_bucket()
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=DOWNLOAD_URL_EXPIRY,
    )
    logger.info("Generated download URL for key=%s", key)
    return url


def upload_buffer(key: str, buffer: bytes, content_type: str) -> None:
    """Upload raw bytes to S3 (used for server-side image processing in later phases)."""
    client = _get_s3_client()
    bucket = _get_bucket()
    client.put_object(Bucket=bucket, Key=key, Body=buffer, ContentType=content_type)
    logger.info("Uploaded buffer (%d bytes) to s3://%s/%s", len(buffer), bucket, key)


def check_connection() -> dict:
    """Verify that the S3 connection and bucket are reachable.

    Returns a dict with 'status' and optional 'error' keys.
    """
    try:
        client = _get_s3_client()
        bucket = _get_bucket()
        client.head_bucket(Bucket=bucket)
        return {"status": "ok", "bucket": bucket}
    except EnvironmentError as exc:
        return {"status": "misconfigured", "error": str(exc)}
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        return {"status": "error", "error": f"S3 ClientError {code}: {exc}"}
    except Exception as exc:
        return {"status": "error", "error": str(exc)}
