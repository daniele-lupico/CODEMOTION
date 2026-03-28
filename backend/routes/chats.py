import json
import os
from fastapi import APIRouter, HTTPException
from config import CHATS_FILE
from models import SaveChatRequest

router = APIRouter()


def _load_chats() -> dict:
    try:
        with open(CHATS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_chats(data: dict) -> None:
    os.makedirs(os.path.dirname(CHATS_FILE), exist_ok=True)
    with open(CHATS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


@router.post("/api/chats/save")
def save_chat(req: SaveChatRequest):
    chats = _load_chats()
    user_chats = chats.get(req.user_id, [])
    # Update existing or append new
    for i, c in enumerate(user_chats):
        if c["id"] == req.chat_id:
            user_chats[i] = {"id": req.chat_id, "title": req.title, "messages": req.messages}
            break
    else:
        user_chats.insert(0, {"id": req.chat_id, "title": req.title, "messages": req.messages})
    # Keep max 50 chats per user
    chats[req.user_id] = user_chats[:50]
    _save_chats(chats)
    return {"status": "saved"}


@router.get("/api/chats/{user_id}")
def get_chats(user_id: str):
    chats = _load_chats()
    return {"chats": chats.get(user_id, [])}


@router.delete("/api/chats/{user_id}/{chat_id}")
def delete_chat(user_id: str, chat_id: str):
    chats = _load_chats()
    user_chats = chats.get(user_id, [])
    chats[user_id] = [c for c in user_chats if c["id"] != chat_id]
    _save_chats(chats)
    return {"status": "deleted"}
