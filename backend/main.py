import os
from fastapi import FastAPI, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from database import init_db, SessionLocal
from models import Guest

app = FastAPI(
    title="Wedding Website API",
    description="API for Tomke & Jan-Paul's Wedding Website",
    version="1.0.0"
)

# Environment-based CORS configuration
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
environment = os.getenv("ENVIRONMENT", "development")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the database on startup
@app.on_event("startup")
def on_startup():
    init_db()

@app.get("/")
def read_root():
    return {
        "message": "Wedding Website Backend is running!",
        "environment": environment,
        "version": "1.0.0"
    }

@app.get("/health")
def health_check():
    return {"status": "healthy", "environment": environment}

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Pydantic model for form data
class GuestCreate(BaseModel):
    name: str
    essenswunsch: str | None = None
    dabei: bool | None = None
    email: str | None = None
    anreise: str | None = None
    essen_fr: bool | None = None
    essen_sa: bool | None = None
    essen_so: bool | None = None
    unterkunft: str | None = None

# Endpoint to receive RSVP form data
@app.post("/rsvp")
def create_guest(guest: GuestCreate, db: Session = Depends(get_db)):
    db_guest = Guest(**guest.dict())
    db.add(db_guest)
    db.commit()
    db.refresh(db_guest)
    return {"success": True, "id": db_guest.id}

# Admin endpoint to get all guests
@app.get("/admin/guests")
def get_all_guests(db: Session = Depends(get_db)):
    guests = db.query(Guest).all()
    return guests

# You can add more endpoints here, e.g. for form submission
