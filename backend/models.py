from pydantic import BaseModel
from typing import Optional


class ChatRequest(BaseModel):
    query: str
    has_new_file: bool = False


class TTSRequest(BaseModel):
    text: str


class CalendarRequest(BaseModel):
    title: str
    date: str
    description: str
    end_date: Optional[str] = None


class RegisterRequest(BaseModel):
    email: str
    password: str
    company: Optional[str] = "My Company"


class LoginRequest(BaseModel):
    email: str
    password: str


class SaveChatRequest(BaseModel):
    user_id: str
    chat_id: str
    title: str
    messages: list


class SaveFolderRequest(BaseModel):
    user_id: str
    folder_id: Optional[str] = None
    name: str


class MoveChatRequest(BaseModel):
    chat_id: str
    folder_id: Optional[str] = None
