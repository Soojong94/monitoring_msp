from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import PortalUser
from schemas import UserCreate, UserUpdate, UserResponse
from auth import hash_password, get_current_user, require_admin

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserResponse], dependencies=[Depends(require_admin)])
def list_users(db: Session = Depends(get_db)):
    return db.query(PortalUser).order_by(PortalUser.id).all()


@router.post("", response_model=UserResponse, dependencies=[Depends(require_admin)])
def create_user(body: UserCreate, db: Session = Depends(get_db)):
    if body.role not in ("admin", "viewer"):
        raise HTTPException(status_code=400, detail="Role must be admin or viewer")
    existing = db.query(PortalUser).filter(PortalUser.username == body.username).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")
    user = PortalUser(
        username=body.username,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserResponse, dependencies=[Depends(require_admin)])
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db)):
    user = db.query(PortalUser).filter(PortalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.role is not None:
        if body.role not in ("admin", "viewer"):
            raise HTTPException(status_code=400, detail="Role must be admin or viewer")
        user.role = body.role
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", dependencies=[Depends(require_admin)])
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    user = db.query(PortalUser).filter(PortalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.username == current_user["sub"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    db.delete(user)
    db.commit()
    return {"message": "User deleted"}


@router.put("/me/password")
def change_my_password(body: UserUpdate, db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if not body.password:
        raise HTTPException(status_code=400, detail="Password required")
    user = db.query(PortalUser).filter(PortalUser.username == current_user["sub"]).first()
    user.password_hash = hash_password(body.password)
    db.commit()
    return {"message": "Password changed"}
