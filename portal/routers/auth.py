from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from database import get_db
from models import PortalUser
from schemas import LoginRequest, TokenResponse
from auth import verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(PortalUser).filter(PortalUser.username == req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user.last_login = datetime.now(timezone.utc).isoformat()
    db.commit()

    token = create_access_token({"sub": user.username, "role": user.role})
    return TokenResponse(access_token=token, role=user.role)


@router.post("/logout")
def logout():
    return {"message": "Logged out"}


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    return {"username": user["sub"], "role": user["role"]}
