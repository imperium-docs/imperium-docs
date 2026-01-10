from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from config import LONG_WINDOW_MIN_SCORE, MIN_BODY_LENGTH, WINDOW_HOURS


def _parse_date(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc)


def _hours_since(value: str) -> float:
    now = datetime.now(timezone.utc)
    parsed = _parse_date(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    delta = now - parsed
    return max(delta.total_seconds() / 3600, 0.0)


def _key_value_score(value: float | None) -> float:
    if value is None:
        return 0.5
    if value >= 1_000_000_000:
        return 2.0
    if value >= 100_000_000:
        return 1.4
    if value >= 10_000_000:
        return 1.1
    return 0.8


def rank_events(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def score(item: dict[str, Any]) -> tuple[float, datetime]:
        evidence = item["evidence"]
        strength = evidence.primary_domains * 1.5 + evidence.secondary_domains
        recency_hours = _hours_since(item["items"][0]["event_at"])
        recency_score = max(0.4, 1.8 - (recency_hours / 72))
        key_score = _key_value_score(item["items"][0].get("key_value_usd"))
        extraction = item["items"][0].get("extraction", {})
        body_len = extraction.get("body_length", 0) or 0
        paywalled = extraction.get("paywalled", False)
        extraction_score = 0.7 if paywalled or body_len < MIN_BODY_LENGTH else 1.0
        total = strength * recency_score * key_score * extraction_score
        published = _parse_date(item["items"][0]["published_at"])
        item["score"] = {
            "total": total,
            "strength": strength,
            "recency_hours": recency_hours,
            "key_value": item["items"][0].get("key_value_usd"),
            "extraction_quality": extraction_score,
        }
        item["window"] = window_bucket(recency_hours, total)
        return (total, published)

    return sorted(items, key=score, reverse=True)


def window_bucket(hours_since: float, score: float) -> str:
    if hours_since <= WINDOW_HOURS[0]:
        return "narrow"
    if hours_since <= WINDOW_HOURS[1]:
        return "medium"
    if hours_since <= WINDOW_HOURS[2] and score >= LONG_WINDOW_MIN_SCORE:
        return "long"
    return "expired"
