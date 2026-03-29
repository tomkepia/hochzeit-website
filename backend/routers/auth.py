import logging
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import SessionLocal
from models import AccessToken

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class TokenRequest(BaseModel):
    token: str


class PasswordLoginRequest(BaseModel):
    password: str


@router.post("/token-login")
def token_login(request: TokenRequest, db: Session = Depends(get_db)):
    """Validate a QR access token. Returns {"status": "ok", "permissions": "..."} on success."""
    token_obj = db.query(AccessToken).filter(AccessToken.token == request.token).first()

    if not token_obj:
        raise HTTPException(status_code=401, detail="Invalid token")

    if token_obj.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Token expired")

    return {"status": "ok", "permissions": token_obj.permissions or ""}


@router.post("/password-login")
def password_login(request: PasswordLoginRequest, db: Session = Depends(get_db)):
    """Exchange the gallery password for a valid access token."""
    expected = os.getenv("GALLERY_PASSWORD")
    if not expected or request.password != expected:
        raise HTTPException(status_code=401, detail="Invalid password")

    now = datetime.utcnow()
    token_obj = (
        db.query(AccessToken)
        .filter(AccessToken.expires_at > now)
        .filter(AccessToken.permissions == "upload:view")
        .order_by(AccessToken.expires_at.desc())
        .first()
    )

    if not token_obj:
        logger.warning("password-login succeeded but no valid token exists in DB")
        raise HTTPException(status_code=500, detail="No valid gallery token available")

    return {
        "token": token_obj.token,
        "expiresAt": token_obj.expires_at.isoformat(),
        "permissions": token_obj.permissions or "",
    }


def require_gallery_access(required_permission: str = None):
    """FastAPI dependency factory that enforces a valid Bearer token.

    Usage:
        Depends(require_gallery_access())              # any valid token
        Depends(require_gallery_access("delete"))      # token must include "delete"

    Returns the AccessToken ORM object so callers can inspect permissions.
    """
    def dependency(request: Request, db: Session = Depends(get_db)):
        auth_header = request.headers.get("Authorization")

        parts = auth_header.split() if auth_header else []
        if len(parts) != 2 or parts[0] != "Bearer":
            raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")

        token = parts[1]

        token_obj = db.query(AccessToken).filter(AccessToken.token == token).first()

        if not token_obj:
            logger.warning("Access attempt with invalid token")
            raise HTTPException(status_code=401, detail="Invalid token")

        if token_obj.expires_at < datetime.utcnow():
            logger.info("Access attempt with expired token id=%s", token_obj.id)
            raise HTTPException(status_code=401, detail="Token expired")

        if required_permission:
            permissions_set = set((token_obj.permissions or "").split(":"))
            if required_permission not in permissions_set:
                raise HTTPException(status_code=403, detail="Insufficient permissions")

        return token_obj

    return dependency
