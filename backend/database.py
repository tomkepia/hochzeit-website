import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from models import Base

# Use environment variables for database configuration
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql://postgres:password@localhost:5432/hochzeit_db"
)

engine = create_engine(
    DATABASE_URL,
    pool_size=20,        # sustained concurrent DB connections
    max_overflow=20,     # burst headroom (total cap: 40, matching uvicorn threadpool)
    pool_timeout=30,     # seconds to wait for a connection before raising
    pool_pre_ping=True,  # discard stale connections after DB restarts
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _ensure_photo_media_columns() -> None:
    """Backfill schema for mixed image/video metadata on existing deployments."""
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE photos ADD COLUMN IF NOT EXISTS media_type VARCHAR"))
        conn.execute(text("ALTER TABLE photos ADD COLUMN IF NOT EXISTS mime_type VARCHAR"))
        conn.execute(text("ALTER TABLE photos ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER"))
        conn.execute(text("ALTER TABLE photos ADD COLUMN IF NOT EXISTS duration_seconds INTEGER"))
        conn.execute(text("ALTER TABLE photos ADD COLUMN IF NOT EXISTS width INTEGER"))
        conn.execute(text("ALTER TABLE photos ADD COLUMN IF NOT EXISTS height INTEGER"))
        conn.execute(text("UPDATE photos SET media_type = 'image' WHERE media_type IS NULL"))
        conn.execute(text("ALTER TABLE photos ALTER COLUMN media_type SET DEFAULT 'image'"))
        conn.execute(text("ALTER TABLE photos ALTER COLUMN media_type SET NOT NULL"))

def init_db():
    Base.metadata.create_all(bind=engine)
    _ensure_photo_media_columns()
