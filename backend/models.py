import uuid

from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime
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
    processing_error = Column(Text)  # stores error message on failure


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
