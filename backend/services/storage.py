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
    return generate_download_url_with_expiry(key, DOWNLOAD_URL_EXPIRY)


def generate_download_url_with_expiry(key: str, expires_in: int) -> str:
    """Generate a pre-signed GET URL with a custom expiry (seconds)."""
    client = _get_s3_client()
    bucket = _get_bucket()
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in,
    )
    logger.info("Generated download URL for key=%s (expires_in=%ds)", key, expires_in)
    return url


def upload_buffer(key: str, buffer: bytes, content_type: str) -> None:
    """Upload raw bytes to S3 (used for server-side image processing in later phases)."""
    client = _get_s3_client()
    bucket = _get_bucket()
    client.put_object(Bucket=bucket, Key=key, Body=buffer, ContentType=content_type)
    logger.info("Uploaded buffer (%d bytes) to s3://%s/%s", len(buffer), bucket, key)


def delete_file(key: str) -> None:
    """Delete a file from S3 by its key."""
    client = _get_s3_client()
    bucket = _get_bucket()
    client.delete_object(Bucket=bucket, Key=key)
    logger.info("Deleted file s3://%s/%s", bucket, key)


def get_object_metadata(key: str) -> dict:
    """Return object metadata for a storage key via head_object."""
    client = _get_s3_client()
    bucket = _get_bucket()
    return client.head_object(Bucket=bucket, Key=key)


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


# Minimum part size for S3 multipart upload (5 MB), except for the last part.
_MULTIPART_MIN_PART_BYTES = 5 * 1024 * 1024


def upload_stream_as_zip(key: str, data_iter) -> None:
    """Stream an iterable of bytes chunks to S3 using multipart upload.

    This allows piping a zipstream generator directly to S3 without buffering
    the entire archive in memory.  Parts are accumulated locally until they
    reach the 5 MB minimum required by S3, then flushed as a part.

    Args:
        key:       Destination S3 key (e.g. "zips/{job_id}.zip").
        data_iter: An iterable yielding bytes chunks (e.g. a zipstream.ZipStream).
    """
    client = _get_s3_client()
    bucket = _get_bucket()

    mpu = client.create_multipart_upload(Bucket=bucket, Key=key, ContentType="application/zip")
    upload_id = mpu["UploadId"]
    parts = []
    part_number = 1
    buffer = b""

    try:
        for chunk in data_iter:
            if not chunk:
                continue
            buffer += chunk
            if len(buffer) >= _MULTIPART_MIN_PART_BYTES:
                response = client.upload_part(
                    Bucket=bucket,
                    Key=key,
                    UploadId=upload_id,
                    PartNumber=part_number,
                    Body=buffer,
                )
                parts.append({"PartNumber": part_number, "ETag": response["ETag"]})
                part_number += 1
                buffer = b""

        # Upload any remaining bytes as the final (possibly smaller) part.
        if buffer:
            response = client.upload_part(
                Bucket=bucket,
                Key=key,
                UploadId=upload_id,
                PartNumber=part_number,
                Body=buffer,
            )
            parts.append({"PartNumber": part_number, "ETag": response["ETag"]})

        client.complete_multipart_upload(
            Bucket=bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={"Parts": parts},
        )
        logger.info("Multipart upload complete for s3://%s/%s (%d part(s))", bucket, key, len(parts))

    except Exception:
        client.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)
        logger.exception("Multipart upload aborted for s3://%s/%s", bucket, key)
        raise
