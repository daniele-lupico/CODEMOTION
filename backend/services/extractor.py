import json
from openai import OpenAI
from config import ANTHROPIC_API_KEY
from services.model_selector import select_model

_client = OpenAI(
    api_key="sk-Ku2I6cYOnJMmZUIFHy0Qvg",  # Regolo key
    base_url="https://api.regolo.ai/v1",
)

_MODEL = "qwen3-coder-next"

_SYSTEM_PROMPT = """Sei un AI Contract Intelligence Engineer per B2B aziendale.
Analizza il documento legale ed estrai i dati in formato JSON strictly-typed.
RESTITUISCI SOLO E SOLTANTO IL JSON VALIDO, SENZA ALCUN TESTO PRIMA O DOPO (NO MARKDOWN ```json).

REGOLE CRITICHE PER L'ESTRAZIONE:

1. value_annual: Calcola SEMPRE dal canone periodico esplicito nel contratto.
   - Se il canone è MENSILE: moltiplica × 12
   - Se il canone è TRIMESTRALE: moltiplica × 4
   - Se il canone è ANNUALE: usa direttamente
   - NON dividere mai total_value per duration_months
   - Se il canone è variabile o non predeterminabile, usa solo la parte fissa ricorrente

2. clauses: Usa questi tipi PRECISI (non inventare categorie generiche):
   - "SLA Penalty" — penali per downtime/SLA
   - "Rinnovo Automatico" — rinnovo automatico con preavviso breve
   - "Sconto Anomalo" — sconto oltre la policy standard
   - "Recesso Vincolato" — contratto senza clausola di recesso anticipato (il cliente è bloccato fino a scadenza)
   - "Penale Rescissione" — penale monetaria specificata per recesso anticipato
   - "Data Retention Risk" — rischio perdita dati per retention breve o cancellazione irreversibile (NON chiamarlo "Lock-in")
   - "Limitazione Responsabilità" — tetto massimo di responsabilità del fornitore (es. 20% dei canoni annui)
   - "Dati Vietati" — divieto di caricare categorie speciali di dati (GDPR art. 9/10)
   - "Verifica Output AI" — responsabilità di verifica output AI generativa trasferita al cliente
   - "Lock-in Tecnologico" — costi di migrazione o dipendenza da stack proprietario
   - "Esclusiva Territoriale" — clausola di esclusiva geografica o settoriale
   - "Non-Compete" — divieto di fornire servizi ai competitor post-contratto
   - "Audit Rights" — diritto di audit del cliente
   - "IP Sharing" — condivisione proprietà intellettuale

3. status: "active" se la data odierna (marzo 2026) è prima di end_date, "expired" altrimenti.

4. recesso: Se il contratto NON prevede recesso anticipato (solo disdetta a scadenza), aggiungi una clausola "Recesso Vincolato" con risk_level "high".

5. notes: Sii preciso sui valori economici effettivi, cita il canone periodico reale.

Il JSON deve avere QUESTA esatta struttura:
{
  "id": "Se presente nel documento usa quell'ID, altrimenti genera CTR-XXX (numero a 3 cifre)",
  "client": "Nome azienda cliente",
  "client_sector": "Settore in inglese: Manufacturing, Retail, Finance, Technology, Consulting, Healthcare, Education, Media",
  "type": "Tipo contrattuale: SaaS Enterprise, Formazione, Consulenza, Cloud Services, Manutenzione, Fornitura Hardware, Outsourcing IT, Sviluppo Custom",
  "product": "Nome del prodotto o servizio",
  "category": "Software | Hardware | Consulting | Cloud | Services | Training",
  "value_annual": 0,
  "total_value": 0,
  "currency": "EUR",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "duration_months": 24,
  "auto_renewal": false,
  "discount_percent": 0,
  "standard_discount": 12,
  "payment_terms_days": 30,
  "status": "active o expired",
  "risk_score": 5,
  "sla": {
    "uptime": "99.9%",
    "response_time_hours": 4,
    "penalty_percent": 0
  },
  "clauses": [
    {
      "type": "tipo clausola dalla lista sopra",
      "description": "Descrizione precisa e testuale della clausola, citando i valori numerici reali",
      "risk_level": "low | medium | high | critical",
      "risk_area": "financial | legal | operational"
    }
  ],
  "next_step_action": "Azione pratica manageriale consigliata, max 1 frase.",
  "notes": "Nota sintetica per l'account manager con valori economici corretti, max 2 frasi."
}"""

def _clean_json(text: str) -> str:
    text = text.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()

def extract_contract(text: str) -> tuple[dict, str, int, int]:
    """Returns (contract_data, model_used, input_tokens, output_tokens)."""
    response = _client.chat.completions.create(
        model=_MODEL,
        max_tokens=2048,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        temperature=0.0,
    )
    raw = _clean_json(response.choices[0].message.content)
    data = json.loads(raw)
    input_tokens = response.usage.prompt_tokens
    output_tokens = response.usage.completion_tokens
    return data, _MODEL, input_tokens, output_tokens