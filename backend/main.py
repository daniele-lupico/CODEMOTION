from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
import tempfile
from typing import List, Dict, Any
from dotenv import load_dotenv
import fitz  # PyMuPDF
from openai import OpenAI
from datetime import datetime
import uuid

class ChatRequest(BaseModel):
    query: str
    has_new_file: bool = False

class TTSRequest(BaseModel):
    text: str

class CalendarRequest(BaseModel):
    title: str
    date: str
    description: str

# Load environment variables
load_dotenv()

app = FastAPI(title="ContractAI Voice API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OpenRouter Config
# It automatically picks up OPENROUTER_API_KEY from the .env file if it's there
# Or we can pass it explicitly.
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

client = OpenAI(
  base_url="https://openrouter.ai/api/v1",
  api_key=OPENROUTER_API_KEY,
)

# Load mock data
DATA_FILE = os.path.join(os.path.dirname(__file__), "data", "contracts.json")
STATS_FILE = os.path.join(os.path.dirname(__file__), "data", "stats.json")

def load_stats():
    try:
        with open(STATS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"total_tokens": 0, "api_cost_usd": 0.0, "hours_saved": 0}

def save_stats(data):
    # Ensure data directory exists
    os.makedirs(os.path.dirname(STATS_FILE), exist_ok=True)
    with open(STATS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def load_data():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"error": "Mock data file not found"}

def save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

@app.get("/")
def read_root():
    return {"message": "ContractAI Voice API is running"}

@app.get("/api/dashboard/overview")
def get_overview():
    data = load_data()
    if "error" in data:
        raise HTTPException(status_code=404, detail="Data not found")
        
    contracts = data.get("contracts", [])
    active_contracts = [c for c in contracts if c.get("status") == "active"]
    total_revenue = sum(c.get("value_annual", 0) for c in contracts)
    
    return {
        "company": data.get("company"),
        "kpis": {
            "total_contracts": len(contracts),
            "active_contracts": len(active_contracts),
            "total_revenue": total_revenue
        },
        "revenue_by_year": data.get("revenue_by_year", {}),
        "revenue_by_category": data.get("revenue_by_category", {})
    }

@app.get("/api/contracts")
def get_contracts():
    data = load_data()
    if "error" in data:
        raise HTTPException(status_code=404, detail="Data not found")
    return {"contracts": data.get("contracts", [])}

@app.get("/api/contracts/{contract_id}")
def get_contract(contract_id: str):
    data = load_data()
    contracts = data.get("contracts", [])
    for c in contracts:
        if c.get("id") == contract_id:
            return c
    raise HTTPException(status_code=404, detail="Contract not found")

@app.post("/api/upload")
async def upload_contract(file: UploadFile = File(...)):
    if not OPENROUTER_API_KEY:
         raise HTTPException(status_code=500, detail="OpenRouter API Key non configurata nel file .env")

    # 1. Salva il file temporaneamente
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            contents = await file.read()
            tmp.write(contents)
            tmp_path = tmp.name
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore salvataggio file: {str(e)}")

    # 2. Estrai il testo con PyMuPDF
    try:
        doc = fitz.open(tmp_path)
        text_content = ""
        for page in doc:
            text_content += page.get_text()
        doc.close()
        os.unlink(tmp_path) # Pulisci il temp file
    except Exception as e:
        if os.path.exists(tmp_path):
             os.unlink(tmp_path)
        raise HTTPException(status_code=500, detail=f"Errore lettura PDF: {str(e)}")

    # Controlla se il testo estratto è vuoto
    if not text_content.strip():
         raise HTTPException(status_code=400, detail="Impossibile estrarre testo dal PDF. Assicurati che non sia un'immagine scannerizzata o protetto da password.")

    # 3. Costruisci il prompt per il LLM
    system_prompt = """
    Sei un AI Contract Intelligence Engineer per B2B aziendale. Devi analizzare il seguente documento legale ed estrarre i dati in formato JSON strictly-typed.
    
    RESTITUISCI SOLO E SOLTANTO IL JSON VALIDO, SENZA ALCUN TESTO PRIMA O DOPO (NO MARKDOWN ```json).
    
    Il JSON deve avere QUESTA esatta struttura e rispettare i tipi di dato indicati:
    {
      "id": "Genera un ID del tipo CTR-XXX in base ad un numero casuale a 3 cifre",
      "client": "Nome dell'azienda cliente (la controparte dell'azienda TechVenture Italia Srl, o del fornitore)",
      "client_sector": "Settore del cliente in inglese es: Manufacturing, Retail, Finance, Technology, Consulting, Cloud",
      "type": "Breve tipo contrattuale es. SaaS Enterprise, Formazione, Consulenza, Cloud Services",
      "product": "Nome del prodotto o servizio",
      "category": "Categoria in inglese tra: Software, Hardware, Consulting, Cloud, Services, Training",
      "value_annual": (int) Valore annuale stimato in valuta. Usa 0 se non specificato,
      "total_value": (int) Valore totale,
      "currency": "EUR" o "USD",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD",
      "duration_months": (int) durata totale in mesi,
      "auto_renewal": (bool) true o false se c'è rinnovo automatico,
      "discount_percent": (int) Sconto applicato rispetto al listino. Usa 12 se non specificato nulla,
      "standard_discount": 12,
      "payment_terms_days": (int) giorni per pagamento fattura es. 30 o 60,
      "status": "active" o "expired" deducendolo dalla data odierna che è marzo 2026,
      "risk_score": (int) Da 1 a 10. (1 = bassissimo rischio, 10 = altissimo rischio per l'azienda che eroga il servizio).
      "sla": {
        "uptime": "percentuale es 99.9% o null",
        "response_time_hours": (int) o null,
        "penalty_percent": (int) percentuale penale max, o 0
      },
      "clauses": [ // IMPORTANTISSIMO: Seleziona tra 1 e 3 clausole notevoli, rischiose o importanti estratte dal contratto
        {
          "type": "Es: SLA Penalty, Rinnovo Automatico, Sconto Anomalo, Penale Rescissione, Lock-in",
          "description": "Una frase descrittiva del rischio/clausola individuata",
          "risk_level": "low" | "medium" | "high" | "critical",
          "risk_area": "financial" | "legal" | "operational"
        }
      ],
      "next_step_action": "Genera tu un'azione pratica manageriale consigliata basata sui rischi o scadenze. Es. 'Fissare meeting per rinegoziare SLA', 'Inviare disdetta rinnovo', 'Monitorare fatturato'. Massimo 1 frase breve.",
      "notes": "Breve nota sintetica sull'analisi aziendale per l'account manager, max 2 frasi."
    }
    
    INFORMAZIONI CONTRATTO:
    """ + text_content

    # 4. Chiama OpenRouter API (usiamo Claude 3.5 Sonnet per affidabilità sul JSON)
    try:
        completion = client.chat.completions.create(
          model="anthropic/claude-3.5-sonnet",
          messages=[
            {
              "role": "user",
              "content": system_prompt
            }
          ],
          temperature=0.0
        )
        
        # 5. Parsing del risultato
        response_text = completion.choices[0].message.content.strip()
        
        # Pulizia base nel caso il modello inserisca tag markdown
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
             response_text = response_text[:-3]
             
        response_text = response_text.strip()
        
        contract_data = json.loads(response_text)
        
        # 6. Aggiorno il database Mock e ricalcolo metrics
        db = load_data()
        db["contracts"].append(contract_data)
        db["total_contracts"] = len(db["contracts"])
        
        # Aggiorna totali e revenue by category / year
        annual = contract_data.get("value_annual", 0)
        category = contract_data.get("category", "Services")
        
        # Fallback rapido per date anno
        start_year = contract_data.get("start_date", "2026")[:4]
        
        if category in db.get("revenue_by_category", {}):
            db["revenue_by_category"][category] += annual
        else:
             db["revenue_by_category"][category] = annual
             
        if start_year in db.get("revenue_by_year", {}):
             db["revenue_by_year"][start_year] += annual
             
        db["total_revenue"] += annual
        
        save_data(db)
        
        return {
            "filename": file.filename,
            "status": "success",
            "message": "Contratto processato con intelligenza artificiale con successo.",
            "job_id": str(uuid.uuid4()),
            "parsed_data": contract_data
        }

    except json.JSONDecodeError as je:
         raise HTTPException(status_code=500, detail=f"Il modello LLM ha restituito un JSON non valido. Testo restituito: {response_text}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore chiamata LLM OpenRouter: {str(e)}")

@app.post("/api/chat")
async def chat_with_assistant(request: ChatRequest):
    if not OPENROUTER_API_KEY:
         raise HTTPException(status_code=500, detail="OpenRouter API Key non configurata")

    # 1. Carica il contesto dal database locale
    data = load_data()
    contracts_summary = ""
    if "error" not in data:
        contracts = data.get("contracts", [])
        # Riduciamo il payload passandogli solo i campi fondamentali per non saturare i token inutilmente
        simplified = []
        for c in contracts:
            simplified.append({
                "id": c.get("id"),
                "client": c.get("client"),
                "value_annual": c.get("value_annual"),
                "status": c.get("status"),
                "end_date": c.get("end_date"),
                "risk_score": c.get("risk_score"),
                "clauses": c.get("clauses", []),
                "notes": c.get("notes")
            })
        contracts_summary = json.dumps(simplified, ensure_ascii=False)

    # 2. Prepara il prompt
    file_context = "L'utente ha appena caricato un nuovo documento contrattuale." if request.has_new_file else ""
    
    system_prompt = f"""
    Sei l'intelligenza artificiale di ContractAI, un assistente legale e analitico avanzato.
    Hai accesso al database attuale dei contratti aziendali: {contracts_summary}
    {file_context}

    REGOLE FONDAMENTALI:
    1. Rispondi in italiano, in modo professionale, conciso e diretto.
    2. CITA SEMPRE LE TUE FONTI in formato Markdown: se parli del contratto di "Acme SpA", includi alla fine della frase un riferimento testuale [Fonte: Acme SpA] oppure [Fonte: CTR-123 - Clausola di Rischio]. È vitale che l'utente sappia da dove provengono i dati.
    3. GRAFICI: Se la domanda richiede la visualizzazione di dati (es. "Mostrami il fatturato per cliente"), DEVI includere nel JSON un oggetto 'chart_data' compatibile con Chart.js v4. (Es: type: 'bar'/'pie'/'doughnut', data: {{labels: [...], datasets: [{{data: [...], label: '...'}}]}}). 
       ATTENZIONE CRITICA: 'chart_data' DEVE ESSERE 100% JSON PURO. È ASSOLUTAMENTE VIETATO INCLUDERE FUNZIONI JAVASCRIPT COME `callback: function()`. USA SOLO STRINGHE, NUMERI, ARRAY E OGGETTI.

    CRITICO: Devi rispondere ESCLUSIVAMENTE con logica da API, cioè con un SOLO OGGETTO JSON valido. NESSUN SALUTO, NESSUN BACKTICK ```json, NIENTE TESTO EXTRA FUORI DAL JSON. Il JSON deve avere due chiavi esatte:
    {{
      "text": "La tua risposta argomentata in Markdown, con [Fonte: ...] inclusa.",
      "chart_data": null oppure {{ l'oggetto config Chart.js PURO }}
    }}
    """

    try:
        completion = client.chat.completions.create(
          model="anthropic/claude-3.5-sonnet",
          messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.query}
          ],
          temperature=0.3
        )
        
        # Track usage
        used_tokens = completion.usage.total_tokens if completion.usage else 0
        cost_usd = (used_tokens / 1000.0) * 0.003  # Stima approssimativa blended input/output costo Sonnet
        
        stats = load_stats()
        stats["total_tokens"] = stats.get("total_tokens", 0) + used_tokens
        stats["api_cost_usd"] = stats.get("api_cost_usd", 0.0) + cost_usd
        save_stats(stats)
        
        response_text = completion.choices[0].message.content.strip()
        
        # Pulizia robusta in caso di allucinazioni di formattazione stringa JSON
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
             response_text = response_text[:-3]
             
        response_text = response_text.strip()
        
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            # Fallback se non è un JSON valido
            return {
                "text": response_text,
                "chart_data": None
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore generazione LLM: {str(e)}")

@app.get("/api/stats")
def get_stats():
    stats = load_stats()
    # Stima base: ogni 2000 token sono circa 1 ora umana di lettura/analisi manuale e drafting risparmiata
    estimated_hours = stats.get("total_tokens", 0) / 2000.0  
    human_cost_saved = estimated_hours * 35.0 # 35 euro l'ora (costo aziendale)
    
    return {
        "api_cost_usd": round(stats.get("api_cost_usd", 0), 4),
        "total_tokens": stats.get("total_tokens", 0),
        "hours_saved": round(estimated_hours, 1),
        "roi_eur": round(human_cost_saved - stats.get("api_cost_usd", 0), 2)
    }

@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    # Skeleton pronto per ElevenLabs
    ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
    VOICE_ID = "21m00Tcm4TlvDq8ikWAM" # Formato tipico Rachel
    
    if ELEVENLABS_API_KEY and ELEVENLABS_API_KEY != "your-elevenlabs-key":
        # Chiamata vera a ElevenLabs
        import requests
        from fastapi.responses import StreamingResponse
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
        headers = {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": ELEVENLABS_API_KEY
        }
        data = {
            "text": request.text,
            "model_id": "eleven_monolingual_v1",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.5}
        }
        # De-commentare domani:
        # response = requests.post(url, json=data, headers=headers)
        # return StreamingResponse(response.iter_content(chunk_size=1024), media_type="audio/mpeg")
        return {"status": "success", "message": "API Key found. Uncomment requests to stream audio."}
    else:
        # Mock Response se manca API Key
        return {"status": "missing_key", "message": "API key required per ElevenLabs, skeleton pronto in main.py."}

@app.post("/api/calendar/schedule")
async def schedule_meeting(req: CalendarRequest):
    # Skeleton pronto per Google Calendar API
    print(f"Richiesta Calendar Ricevuta: Titolo='{req.title}' Data='{req.date}' Desc='{req.description}'")
    
    return {
        "status": "success", 
        "event_link": "https://calendar.google.com/calendar/u/0/r/eventedit",
        "message": f"Evento '{req.title}' agganciato (Mock per {req.date})"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
