import os
from fastapi import FastAPI, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from database import init_db, SessionLocal
from models import Guest
from openpyxl import Workbook
from io import BytesIO

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

# Admin endpoint to delete a guest
@app.delete("/admin/guests/{guest_id}")
def delete_guest(guest_id: int, db: Session = Depends(get_db)):
    guest = db.query(Guest).filter(Guest.id == guest_id).first()
    if guest is None:
        return {"success": False, "error": "Guest not found"}
    
    db.delete(guest)
    db.commit()
    return {"success": True, "message": "Guest deleted successfully"}

# Admin endpoint to update a guest
@app.put("/admin/guests/{guest_id}")
def update_guest(guest_id: int, guest: GuestCreate, db: Session = Depends(get_db)):
    db_guest = db.query(Guest).filter(Guest.id == guest_id).first()
    if db_guest is None:
        return {"success": False, "error": "Guest not found"}
    
    # Update guest fields
    for key, value in guest.dict().items():
        setattr(db_guest, key, value)
    
    db.commit()
    db.refresh(db_guest)
    return {"success": True, "guest": db_guest}

# Admin endpoint to export guests as Excel
@app.get("/admin/guests/export")
def export_guests(db: Session = Depends(get_db)):
    guests = db.query(Guest).all()
    
    # Create workbook and worksheet
    wb = Workbook()
    ws = wb.active
    ws.title = "Gäste"
    
    # Add headers
    headers = ["ID", "Name", "Essenswunsch", "Dabei", "Email", "Anreise", 
               "Essen Fr", "Essen Sa", "Essen So", "Unterkunft"]
    ws.append(headers)
    
    # Add data
    for guest in guests:
        dabei_text = "Ja" if guest.dabei is True else "Nein" if guest.dabei is False else "Ausstehend"
        row = [
            guest.id,
            guest.name,
            guest.essenswunsch or "",
            dabei_text,
            guest.email or "",
            guest.anreise or "",
            "Ja" if guest.essen_fr else "Nein",
            "Ja" if guest.essen_sa else "Nein",
            "Ja" if guest.essen_so else "Nein",
            guest.unterkunft or ""
        ]
        ws.append(row)
    
    # Save to BytesIO
    excel_file = BytesIO()
    wb.save(excel_file)
    excel_file.seek(0)
    
    # Return as streaming response
    return StreamingResponse(
        excel_file,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=gaeste.xlsx"}
    )

# You can add more endpoints here, e.g. for form submission
