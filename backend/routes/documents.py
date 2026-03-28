import os
import json
import tempfile
import uuid
import traceback
from fastapi import APIRouter, File, UploadFile, HTTPException
from config import DATA_FILE
from services.parser import extract_text
from services.extractor import extract_contract
from services.cost_tracker import calculate_cost, update_stats

router = APIRouter()

def _load_db() -> dict:
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {
            "company": "TechVenture Italia Srl",
            "extraction_date": "",
            "total_contracts": 0,
            "total_revenue": 0,
            "revenue_by_year": {},
            "revenue_by_category": {},
            "contracts": [],
        }

def _save_db(data: dict) -> None:
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

@router.post("/api/upload")
async def upload_contract(file: UploadFile = File(...)):
    suffix = os.path.splitext(file.filename)[1] or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        text, pages = extract_text(tmp_path, file.filename)
    except ValueError as e:
        traceback.print_exc()
        os.unlink(tmp_path)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise HTTPException(status_code=500, detail=f"Errore lettura file: {e}")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    if not text.strip():
        raise HTTPException(status_code=400, detail="Impossibile estrarre testo. PDF scansionato o protetto?")

    try:
        contract_data, model_used, in_tok, out_tok = extract_contract(text)
    except json.JSONDecodeError as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Il modello ha restituito JSON non valido: {e}")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Errore AI: {e}")

    db = _load_db()

    # Upsert: match by (product + start_date + end_date) — stable fingerprint
    # regardless of AI extracting different IDs or client names on re-upload
    new_product = (contract_data.get("product") or "").strip().lower()
    new_start = contract_data.get("start_date", "")
    new_end = contract_data.get("end_date", "")
    replaced = False
    for i, existing in enumerate(db.get("contracts", [])):
        ex_product = (existing.get("product") or "").strip().lower()
        if ex_product == new_product and existing.get("start_date") == new_start and existing.get("end_date") == new_end:
            db["contracts"][i] = contract_data
            replaced = True
            break

    if not replaced:
        db["contracts"].append(contract_data)
    db["total_contracts"] = len(db["contracts"])

    # Recompute aggregations from scratch to avoid accumulation errors
    revenue_by_category: dict = {}
    revenue_by_year: dict = {}
    total_revenue = 0
    for c in db["contracts"]:
        annual = c.get("value_annual", 0) or 0
        cat = c.get("category", "Services")
        year = str(c.get("start_date", "2026"))[:4]
        revenue_by_category[cat] = revenue_by_category.get(cat, 0) + annual
        revenue_by_year[year] = revenue_by_year.get(year, 0) + annual
        total_revenue += annual
    db["revenue_by_category"] = revenue_by_category
    db["revenue_by_year"] = revenue_by_year
    db["total_revenue"] = total_revenue

    db["last_uploaded"] = {"id": contract_data.get("id", ""), "client": contract_data.get("client", "")}
    _save_db(db)

    cost = calculate_cost(model_used, in_tok, out_tok)
    update_stats(cost, in_tok, out_tok, pages)

    return {
        "filename": file.filename,
        "status": "success",
        "message": "Contratto analizzato con successo.",
        "job_id": str(uuid.uuid4()),
        "model_used": model_used,
        "pages": pages,
        "parsed_data": contract_data,
    }

@router.get("/api/contracts")
def list_contracts():
    db = _load_db()
    return {"contracts": db.get("contracts", [])}

@router.get("/api/contracts/{contract_id}")
def get_contract(contract_id: str):
    db = _load_db()
    for c in db.get("contracts", []):
        if c.get("id") == contract_id:
            return c
    raise HTTPException(status_code=404, detail="Contratto non trovato")