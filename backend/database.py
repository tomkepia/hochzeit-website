import os
from sqlalchemy import create_engine
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

def init_db():
    Base.metadata.create_all(bind=engine)
