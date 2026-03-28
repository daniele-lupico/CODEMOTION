import json
import os
import uuid
from fastapi import APIRouter
from config import FOLDERS_FILE, CHATS_FILE
from models import SaveFolderRequest, MoveChatRequest

router = APIRouter()


def _load_json(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_json(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


@router.get("/api/folders/{user_id}")
def get_folders(user_id: str):
    folders = _load_json(FOLDERS_FILE)
    return {"folders": folders.get(user_id, [])}


@router.post("/api/folders/save")
def save_folder(req: SaveFolderRequest):
    folders = _load_json(FOLDERS_FILE)
    user_folders = folders.get(req.user_id, [])
    # Update existing or create new
    fid = req.folder_id
    for i, f in enumerate(user_folders):
        if f["id"] == fid:
            user_folders[i]["name"] = req.name
            break
    else:
        new_id = fid if fid else str(uuid.uuid4())
        user_folders.append({"id": new_id, "name": req.name})
        fid = new_id
    folders[req.user_id] = user_folders
    _save_json(FOLDERS_FILE, folders)
    return {"status": "saved", "folder_id": fid, "folders": user_folders}


@router.delete("/api/folders/{user_id}/{folder_id}")
def delete_folder(user_id: str, folder_id: str):
    # Remove folder
    folders = _load_json(FOLDERS_FILE)
    folders[user_id] = [f for f in folders.get(user_id, []) if f["id"] != folder_id]
    _save_json(FOLDERS_FILE, folders)
    # Unassign chats from this folder
    chats = _load_json(CHATS_FILE)
    for c in chats.get(user_id, []):
        if c.get("folder_id") == folder_id:
            c.pop("folder_id", None)
    _save_json(CHATS_FILE, chats)
    return {"status": "deleted"}


@router.patch("/api/folders/{user_id}/move")
def move_chat(user_id: str, req: MoveChatRequest):
    chats = _load_json(CHATS_FILE)
    user_chats = chats.get(user_id, [])
    for c in user_chats:
        if c["id"] == req.chat_id:
            if req.folder_id:
                c["folder_id"] = req.folder_id
            else:
                c.pop("folder_id", None)
            break
    chats[user_id] = user_chats
    _save_json(CHATS_FILE, chats)
    return {"status": "moved"}
