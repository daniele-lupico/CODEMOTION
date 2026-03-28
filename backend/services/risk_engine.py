from datetime import date, datetime


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def analyze_portfolio(contracts: list[dict]) -> dict:
    """Return portfolio-level risk summary for the analytics dashboard."""
    today = date.today()

    expiring_soon = []
    high_risk = []
    anomalous_discounts = []
    total_revenue = 0
    revenue_by_client = {}
    clause_types: dict[str, int] = {}

    for c in contracts:
        annual = c.get("value_annual", 0)
        total_revenue += annual
        client = c.get("client", "Unknown")
        revenue_by_client[client] = revenue_by_client.get(client, 0) + annual

        # Expiring within 60 days
        end = _parse_date(c.get("end_date"))
        if end:
            days_left = (end - today).days
            if 0 <= days_left <= 60:
                expiring_soon.append({
                    "id": c.get("id"),
                    "client": client,
                    "end_date": c.get("end_date"),
                    "days_left": days_left,
                    "auto_renewal": c.get("auto_renewal", False),
                })

        # High risk score
        risk = c.get("risk_score", 0)
        if risk >= 7:
            high_risk.append({
                "id": c.get("id"),
                "client": client,
                "risk_score": risk,
                "notes": c.get("notes", ""),
            })

        # Non-standard discounts
        discount = c.get("discount_percent", 0)
        standard = c.get("standard_discount", 12)
        if discount > standard:
            anomalous_discounts.append({
                "id": c.get("id"),
                "client": client,
                "discount_percent": discount,
                "standard_discount": standard,
                "excess": discount - standard,
            })

        # Clause type frequency
        for clause in c.get("clauses", []):
            ctype = clause.get("type", "Other")
            clause_types[ctype] = clause_types.get(ctype, 0) + 1

    # Top 5 clients by revenue (concentration risk)
    top_clients = sorted(revenue_by_client.items(), key=lambda x: x[1], reverse=True)[:5]
    concentration = round(sum(v for _, v in top_clients) / total_revenue * 100, 1) if total_revenue else 0

    return {
        "total_contracts": len(contracts),
        "total_revenue": total_revenue,
        "expiring_soon": sorted(expiring_soon, key=lambda x: x["days_left"]),
        "high_risk_contracts": high_risk,
        "anomalous_discounts": anomalous_discounts,
        "top_clients_by_revenue": [{"client": c, "value": v} for c, v in top_clients],
        "concentration_top5_percent": concentration,
        "clause_frequency": clause_types,
    }
