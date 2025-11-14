from fastapi import FastAPI, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from backend.database import init_db, SessionLocal
from backend.models import Guest

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Or specify your frontend URL
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
    return {"message": "Backend is running!"}

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

# You can add more endpoints here, e.g. for form submission
