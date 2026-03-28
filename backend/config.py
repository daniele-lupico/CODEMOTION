import os
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
PORT = int(os.getenv("PORT", 8000))

_BASE = os.path.dirname(__file__)
DATA_DIR = os.path.join(_BASE, "data")
DATA_FILE = os.path.join(DATA_DIR, "contracts.json")
STATS_FILE = os.path.join(DATA_DIR, "stats.json")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
CHATS_FILE   = os.path.join(DATA_DIR, "chats.json")
FOLDERS_FILE = os.path.join(DATA_DIR, "folders.json")
UPLOADS_DIR = os.path.join(_BASE, "contracts")
TEXTS_DIR   = os.path.join(DATA_DIR, "texts")
