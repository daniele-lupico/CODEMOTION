import json
import os
from config import STATS_FILE

# Pricing per 1K tokens (Anthropic, March 2026)
_PRICING = {
    "claude-haiku-4-5-20251001": {"input": 0.00025, "output": 0.00125},
    "claude-sonnet-4-6":         {"input": 0.003,   "output": 0.015},
}
_HUMAN_COST_EUR_PER_HOUR = 35.0


def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    p = _PRICING.get(model, _PRICING["claude-sonnet-4-6"])
    return input_tokens / 1000 * p["input"] + output_tokens / 1000 * p["output"]


def load_stats() -> dict:
    try:
        with open(STATS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"total_tokens": 0, "api_cost_usd": 0.0, "hours_saved": 0.0}


def save_stats(data: dict) -> None:
    os.makedirs(os.path.dirname(STATS_FILE), exist_ok=True)
    with open(STATS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def update_stats(cost_usd: float, input_tokens: int = 0, output_tokens: int = 0, pages: int = 0) -> None:
    stats = load_stats()
    stats["api_cost_usd"] = round(stats["api_cost_usd"] + cost_usd, 6)
    stats["total_tokens"] = stats["total_tokens"] + input_tokens + output_tokens
    if pages:
        # 15 minutes per page → hours
        stats["hours_saved"] = round(stats["hours_saved"] + pages * 15 / 60, 2)
    save_stats(stats)


def get_roi(stats: dict) -> float:
    """ROI in EUR: human time saved in money minus API cost."""
    human_value = stats["hours_saved"] * _HUMAN_COST_EUR_PER_HOUR
    return round(human_value - stats["api_cost_usd"], 2)
