"""Video processing service for mixed-media gallery support.

Responsibilities:
- Download original video from object storage
- Probe duration/resolution metadata
- Generate a poster thumbnail (JPEG)
- Upload poster variant to S3
- Persist media metadata and poster keys in DB

The worker owns processing status transitions and retries.
"""

import json
import logging
import os
import subprocess
import tempfile
import time
import uuid as uuid_lib
from pathlib import Path
from typing import Any

from database import SessionLocal
from models import Photo
from services import storage

logger = logging.getLogger(__name__)

MAX_VIDEO_DURATION_SECONDS = int(os.getenv("MAX_VIDEO_DURATION_SECONDS", "180"))
DOWNLOAD_TIMEOUT_SECONDS = 120
MAX_RETRIES = 2
RETRY_DELAY_SECONDS = 3

POSTER_QUALITY = 4
POSTER_MAX_SIZE = "1280:-1"


def process_video_safe(photo_id: str) -> None:
    """Process a video and re-raise exceptions so the worker can retry."""
    try:
        _process_video(photo_id)
    except Exception:
        logger.exception("Video processing failed for photo_id=%s", photo_id)
        raise


def _process_video(photo_id: str) -> None:
    start_time = time.monotonic()
    db = SessionLocal()

    try:
        photo = db.query(Photo).filter(Photo.id == uuid_lib.UUID(photo_id)).first()
        if photo is None:
            raise RuntimeError(f"Photo not found in DB: {photo_id}")

        if photo.thumbnail_key:
            logger.info("Video processing: skipping %s - poster already exists", photo_id)
            return

        if not photo.original_key:
            raise RuntimeError("Missing original key")

        with tempfile.TemporaryDirectory(prefix="video-processing-") as tmp_dir:
            source_path = Path(tmp_dir) / "source"
            source_ext = _extension_from_key(photo.original_key)
            if source_ext:
                source_path = Path(f"{source_path}.{source_ext}")

            _download_original_with_retry(photo.original_key, source_path)

            metadata = _probe_video_metadata(source_path)
            duration_seconds = _safe_round(metadata.get("duration"))
            width = _safe_int(metadata.get("width"))
            height = _safe_int(metadata.get("height"))

            if duration_seconds is not None and duration_seconds > MAX_VIDEO_DURATION_SECONDS:
                raise RuntimeError(
                    f"Video too long ({duration_seconds}s). Maximum is {MAX_VIDEO_DURATION_SECONDS}s"
                )

            poster_path = Path(tmp_dir) / "poster.jpg"
            _generate_poster(source_path, poster_path)

            poster_bytes = poster_path.read_bytes()
            thumb_key = storage.generate_photo_key(photo.category, "thumb", str(photo.id), extension="jpg")
            storage.upload_buffer(thumb_key, poster_bytes, "image/jpeg")
            thumb_url = storage.get_file_url(thumb_key)

            photo.thumbnail_key = thumb_key
            photo.thumbnail_url = thumb_url
            photo.media_type = "video"
            photo.duration_seconds = duration_seconds
            photo.width = width
            photo.height = height
            db.commit()

        elapsed = time.monotonic() - start_time
        logger.info(
            "Video processing done for %s in %.2fs (duration=%s, resolution=%sx%s)",
            photo_id,
            elapsed,
            duration_seconds,
            width,
            height,
        )

    finally:
        db.close()


def _extension_from_key(key: str) -> str:
    last = key.rsplit("/", 1)[-1]
    if "." not in last:
        return ""
    ext = last.rsplit(".", 1)[-1].strip().lower()
    return "".join(ch for ch in ext if ch.isalnum())


def _download_original_with_retry(key: str, out_path: Path) -> None:
    for attempt in range(1, MAX_RETRIES + 2):
        try:
            url = storage.generate_download_url(key)
            # Use curl because it supports signed URLs robustly and writes to file directly.
            _run_checked(
                [
                    "curl",
                    "--fail",
                    "--silent",
                    "--show-error",
                    "--location",
                    "--max-time",
                    str(DOWNLOAD_TIMEOUT_SECONDS),
                    "--output",
                    str(out_path),
                    url,
                ]
            )
            if not out_path.exists() or out_path.stat().st_size == 0:
                raise RuntimeError("Downloaded file is empty")
            return
        except Exception as exc:
            logger.warning(
                "Video download attempt %d/%d failed for key=%s: %s",
                attempt,
                MAX_RETRIES + 1,
                key,
                exc,
            )
            if attempt <= MAX_RETRIES:
                time.sleep(RETRY_DELAY_SECONDS)

    raise RuntimeError("Failed to download original video after retries")


def _probe_video_metadata(source_path: Path) -> dict[str, Any]:
    result = _run_checked(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
            str(source_path),
        ]
    )
    payload = json.loads(result.stdout or "{}")
    stream = (payload.get("streams") or [{}])[0]
    video_format = payload.get("format") or {}
    return {
        "width": stream.get("width"),
        "height": stream.get("height"),
        "duration": video_format.get("duration"),
    }


def _generate_poster(source_path: Path, poster_path: Path) -> None:
    _run_checked(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            "00:00:01",
            "-i",
            str(source_path),
            "-frames:v",
            "1",
            "-vf",
            f"scale={POSTER_MAX_SIZE}",
            "-q:v",
            str(POSTER_QUALITY),
            str(poster_path),
        ]
    )


def _run_checked(args: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"Required binary not found: {args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        raise RuntimeError(stderr or f"Command failed: {' '.join(args)}") from exc


def _safe_round(value: Any) -> int | None:
    try:
        numeric = float(value)
        if numeric <= 0:
            return None
        return int(round(numeric))
    except Exception:
        return None


def _safe_int(value: Any) -> int | None:
    try:
        parsed = int(value)
        return parsed if parsed > 0 else None
    except Exception:
        return None
