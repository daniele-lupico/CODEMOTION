from fastapi import APIRouter
from services.risk_engine import analyze_portfolio
from services.cost_tracker import load_stats, get_roi
from routes.documents import _load_db

router = APIRouter()


@router.get("/api/dashboard/overview")
def dashboard_overview():
    db = _load_db()
    contracts = db.get("contracts", [])
    active = [c for c in contracts if c.get("status") == "active"]
    total_revenue = sum(c.get("value_annual", 0) for c in contracts)

    return {
        "company": db.get("company", "TechVenture Italia Srl"),
        "kpis": {
            "total_contracts": len(contracts),
            "active_contracts": len(active),
            "total_revenue": total_revenue,
        },
        "revenue_by_year": db.get("revenue_by_year", {}),
        "revenue_by_category": db.get("revenue_by_category", {}),
    }


@router.get("/api/analytics/portfolio")
def portfolio_analysis():
    db = _load_db()
    contracts = db.get("contracts", [])
    return analyze_portfolio(contracts)


@router.get("/api/stats")
def get_stats():
    stats = load_stats()
    roi = get_roi(stats)
    return {
        "api_cost_usd": round(stats.get("api_cost_usd", 0), 4),
        "total_tokens": stats.get("total_tokens", 0),
        "hours_saved": round(stats.get("hours_saved", 0), 1),
        "roi_eur": roi,
    }
