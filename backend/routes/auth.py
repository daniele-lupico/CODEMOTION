import json
import hashlib
import uuid
import os
from fastapi import APIRouter, HTTPException
from config import USERS_FILE
from models import RegisterRequest, LoginRequest

router = APIRouter()


def _load_users() -> dict:
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_users(data: dict) -> None:
    os.makedirs(os.path.dirname(USERS_FILE), exist_ok=True)
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _hash(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


@router.post("/api/auth/register")
def register(req: RegisterRequest):
    users = _load_users()
    email = req.email.lower().strip()
    token = str(uuid.uuid4())
    if email in users:
        # Update password and token (useful for demo / password reset)
        users[email]["password_hash"] = _hash(req.password)
        users[email]["token"] = token
        if req.company:
            users[email]["company"] = req.company
        user_id = users[email]["user_id"]
    else:
        user_id = str(uuid.uuid4())
        users[email] = {
            "user_id": user_id,
            "password_hash": _hash(req.password),
            "company": req.company or "",
            "token": token,
        }
    _save_users(users)
    return {"token": token, "user_id": user_id, "company": users[email]["company"], "email": email}


@router.post("/api/auth/login")
def login(req: LoginRequest):
    users = _load_users()
    email = req.email.lower().strip()
    user = users.get(email)
    if not user or user["password_hash"] != _hash(req.password):
        raise HTTPException(status_code=401, detail="Email o password errati.")
    # Regenerate token on login
    token = str(uuid.uuid4())
    user["token"] = token
    _save_users(users)
    return {
        "token": token,
        "user_id": user["user_id"],
        "company": user.get("company", ""),
        "email": email,
    }


@router.get("/api/auth/verify")
def verify(token: str):
    users = _load_users()
    for email, user in users.items():
        if user.get("token") == token:
            return {"valid": True, "user_id": user["user_id"], "company": user.get("company", ""), "email": email}
    raise HTTPException(status_code=401, detail="Token non valido.")
