import json
import re
import base64
import traceback
from openai import OpenAI
from fastapi import APIRouter, HTTPException
from models import ChatRequest, TTSRequest, CalendarRequest
from services.citation import build_chat_system_prompt
from services.cost_tracker import calculate_cost, update_stats
from services.elevenlabs import text_to_speech, is_configured
from routes.documents import _load_db

router = APIRouter()

_client = OpenAI(
    api_key="sk-Ku2I6cYOnJMmZUIFHy0Qvg",  # Regolo key
    base_url="https://api.regolo.ai/v1",
)

_MODEL = "qwen3-coder-next"

def _contracts_summary(contracts: list[dict]) -> str:
    slim = [
        {
            "id": c.get("id"),
            "client": c.get("client"),
            "value_annual": c.get("value_annual"),
            "status": c.get("status"),
            "end_date": c.get("end_date"),
            "risk_score": c.get("risk_score"),
            "clauses": c.get("clauses", []),
            "notes": c.get("notes"),
        }
        for c in contracts
    ]
    return json.dumps(slim, ensure_ascii=False)

def _clean_json(text: str) -> str:
    text = text.strip()
    for prefix in ("```json", "```"):
        if text.startswith(prefix):
            text = text[len(prefix):]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    # Remove JS function callbacks that break JSON.parse (e.g. "callback": function(...){...})
    text = re.sub(r':\s*function\s*\([^)]*\)\s*\{[^{}]*\}', ': null', text)
    return text

@router.post("/api/chat")
async def chat(request: ChatRequest):
    db = _load_db()
    contracts = db.get("contracts", [])

    if request.has_new_file:
        # Focus only on the uploaded contract — pass just that one to the AI
        last = db.get("last_uploaded", {})
        last_id = last.get("id", "")
        last_client = last.get("client", "")
        uploaded = next(
            (c for c in contracts
             if c.get("id") == last_id and c.get("client") == last_client),
            None
        )
        context_contracts = [uploaded] if uploaded else contracts
        file_note = (
            f"L'utente ha appena caricato il contratto {last_id} ({last_client}). "
            f"Analizza ESCLUSIVAMENTE questo contratto. "
            f"Tutti i grafici e le analisi devono basarsi solo sui dati di questo contratto."
        )
    else:
        context_contracts = contracts
        file_note = ""

    system_prompt = build_chat_system_prompt(_contracts_summary(context_contracts))
    user_msg = (file_note + "\n\n" + request.query).strip()

    try:
        response = _client.chat.completions.create(
            model=_MODEL,
            max_tokens=2048,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.3,
        )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Errore AI: {e}")

    raw = _clean_json(response.choices[0].message.content)

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {"text": raw, "chart_data": None}

    input_tokens = response.usage.prompt_tokens
    output_tokens = response.usage.completion_tokens
    cost = calculate_cost(_MODEL, input_tokens, output_tokens)
    update_stats(cost, input_tokens, output_tokens)

    return result

@router.post("/api/tts")
async def tts(request: TTSRequest):
    if not is_configured():
        return {"status": "missing_key", "message": "ELEVENLABS_API_KEY non configurata nel .env"}
    try:
        audio_bytes = text_to_speech(request.text)
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
        return {"status": "success", "audio_base64": audio_b64, "message": "Audio generato con ElevenLabs"}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Errore ElevenLabs: {e}")

@router.post("/api/calendar/schedule")
async def schedule_meeting(req: CalendarRequest):
    from urllib.parse import quote

    def _gcal_date(iso: str) -> str:
        # Convert YYYY-MM-DD or ISO datetime to GCal format YYYYMMDD
        return iso[:10].replace("-", "")

    start = _gcal_date(req.date)
    end   = _gcal_date(req.end_date) if req.end_date else start
    # All-day event: end date must be day after
    from datetime import date, timedelta
    end_dt = (date.fromisoformat(end[:4] + "-" + end[4:6] + "-" + end[6:8]) + timedelta(days=1)).strftime("%Y%m%d")

    params = (
        f"action=TEMPLATE"
        f"&text={quote(req.title)}"
        f"&dates={start}/{end_dt}"
        f"&details={quote(req.description)}"
        f"&sf=true&output=xml"
    )
    event_link = f"https://calendar.google.com/calendar/render?{params}"
    return {
        "status": "success",
        "event_link": event_link,
        "message": f"Evento '{req.title}' pronto per Google Calendar",
    }