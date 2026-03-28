import requests
from config import ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID


def text_to_speech(text: str) -> bytes:
    """Call ElevenLabs TTS and return raw MP3 bytes."""
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}"
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
    }
    payload = {
        "text": text[:2500],  # keep within ElevenLabs free-tier limits
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
    }
    response = requests.post(url, json=payload, headers=headers, timeout=30)
    response.raise_for_status()
    return response.content


def is_configured() -> bool:
    return bool(ELEVENLABS_API_KEY and not ELEVENLABS_API_KEY.startswith("your-"))
