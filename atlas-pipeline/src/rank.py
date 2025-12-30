from __future__ import annotations

from datetime import datetime
from typing import Any


def _parse_date(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return datetime.min


def rank_events(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def score(item: dict[str, Any]) -> tuple[float, datetime]:
        evidence = item["evidence"]
        strength = evidence.primary * 2 + evidence.secondary + evidence.research * 0.5
        published = _parse_date(item["items"][0]["published_at"])
        return (strength, published)

    return sorted(items, key=score, reverse=True)
