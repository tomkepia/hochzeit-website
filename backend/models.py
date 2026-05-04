import uuid

from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func
from sqlalchemy import UniqueConstraint

Base = declarative_base()


class Photo(Base):
    __tablename__ = "photos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # *_key columns are the canonical S3 keys — always use these to generate signed URLs.
    # *_url columns are non-expiring path references (NOT access URLs) kept for convenience.
    original_key = Column(Text)  # nullable for migration safety; always set by new registrations
    original_url = Column(Text, nullable=False)
    preview_key = Column(Text)   # set by Phase 3 after processing
    preview_url = Column(Text)
    thumbnail_key = Column(Text) # set by Phase 3 after processing
    thumbnail_url = Column(Text)
    category = Column(String, nullable=False)  # "guest" | "photographer"
    created_at = Column(DateTime, server_default=func.now())
    # EXIF capture timestamp; nullable for backward compatibility with old rows.
    taken_at = Column(DateTime, nullable=True)
    uploaded_by = Column(String)
    # Processing status: "pending" | "processing" | "done" | "failed"
    processing_status = Column(String, default="pending")
    # Incremented by the worker each time it claims the job.  Allows capping retries.
    # Migration for existing databases: ALTER TABLE photos ADD COLUMN processing_attempts INTEGER NOT NULL DEFAULT 0;
    processing_attempts = Column(Integer, default=0, server_default="0", nullable=False)
    processing_error = Column(Text)  # stores error message on failure
    # Earliest time the worker may next attempt this job (backoff).
    # NULL = job is ready to run immediately.
    # Migration for existing databases: ALTER TABLE photos ADD COLUMN next_attempt_at TIMESTAMP NULL;
    next_attempt_at = Column(DateTime, nullable=True)
    # Timestamp when processing last completed successfully.
    # Migration for existing databases: ALTER TABLE photos ADD COLUMN processed_at TIMESTAMP NULL;
    processed_at = Column(DateTime, nullable=True)


class Guest(Base):
    __tablename__ = "guest"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    essenswunsch = Column(String)
    dabei = Column(Boolean)
    email = Column(String)
    anreise = Column(String)
    essen_fr = Column(Boolean)
    essen_sa = Column(Boolean)
    essen_so = Column(Boolean)
    unterkunft = Column(String)


class AccessToken(Base):
    __tablename__ = "access_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token = Column(Text, unique=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    permissions = Column(String)  # e.g. "upload:view"


class DownloadJob(Base):
    __tablename__ = "download_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Owner: hashed gallery token so jobs are scoped per-user without exposing the raw token.
    owner_key = Column(Text, nullable=False, index=True)
    # 'user' | 'archive_fixed' | 'archive_tail'
    job_kind = Column(String, nullable=False, default="user")
    # 'guest' | 'photographer' for archive jobs; nullable for user jobs.
    category = Column(String, nullable=True)
    # 1-based fixed archive segment index; NULL for user jobs and rolling tail jobs.
    segment_index = Column(Integer, nullable=True)
    # Suggested filename presented to the browser.
    file_name = Column(Text, nullable=True)
    # 'queued' | 'processing' | 'ready' | 'failed'
    status = Column(String, nullable=False, default="queued")
    # IDs of photos to include, stored as a JSON array.
    photo_ids = Column(JSON, nullable=False)
    # S3 key of the produced ZIP, set when status becomes 'ready'.
    zip_key = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    # When the job (and its ZIP) should be deleted.
    expires_at = Column(DateTime, nullable=False)
