from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

from config import ALLOWED_EVENT_TYPES

NUMBER_RE = re.compile(r"([0-9][0-9,\.]*)\s*(trillion|tn|billion|bn|million|m)?", re.IGNORECASE)


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def parse_date(value: str) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except Exception:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return datetime.now(timezone.utc)


def classify_event(text: str) -> str:
    lowered = text.lower()
    if "ipo" in lowered:
        return "ipo"
    if "billionaire" in lowered or "billion" in lowered or "bilion" in lowered:
        return "billionaire"
    if "revenue" in lowered or "record" in lowered:
        return "revenue_record"
    return "revenue_record"


def classify_label(event_type: str) -> str:
    if event_type == "ipo":
        return "IPO"
    if event_type == "billionaire":
        return "Billionaire"
    return "Revenue"


def derive_entity_name(title: str, fallback: str) -> str:
    if not title:
        return fallback
    for separator in (" - ", " | ", ": "):
        if separator in title:
            title = title.split(separator)[0]
            break
    return title.strip() or fallback


def extract_key_value_usd(text: str) -> float | None:
    best: float | None = None
    for match in NUMBER_RE.finditer(text):
        raw = match.group(1).replace(",", "")
        try:
            value = float(raw)
        except ValueError:
            continue
        unit = (match.group(2) or "").lower()
        if unit in ("trillion", "tn"):
            value *= 1_000_000_000_000
        elif unit in ("billion", "bn"):
            value *= 1_000_000_000
        elif unit in ("million", "m"):
            value *= 1_000_000
        if best is None or value > best:
            best = value
    return best


def stable_event_id(event_type: str, entity: str, event_date: str, key_value: float | None) -> str:
    key = "" if key_value is None else f"{key_value:.2f}"
    raw = f"{event_type}|{entity}|{event_date}|{key}"
    return hashlib.sha1(raw.encode("utf8")).hexdigest()[:14]


def normalize_entry(payload: dict[str, Any]) -> dict[str, Any]:
    source = payload["source"]
    entry = payload["entry"]
    title = _safe_text(entry.get("title"))
    summary = _safe_text(entry.get("summary"))
    content = _safe_text(entry.get("content"))
    published_at = parse_date(_safe_text(entry.get("published"))).isoformat()
    event_type = classify_event(f"{title} {summary}")
    if event_type not in ALLOWED_EVENT_TYPES:
        event_type = "revenue_record"
    entity = derive_entity_name(title, source.name)
    key_value = extract_key_value_usd(f"{title} {summary}")
    event_date = published_at[:10]
    event_id = stable_event_id(event_type, entity, event_date, key_value)
    return {
        "event_id": event_id,
        "event_type": event_type,
        "category_label": classify_label(event_type),
        "entity": entity,
        "title": title or entity,
        "summary": summary or title or entity,
        "content": content,
        "published_at": published_at,
        "event_date": event_date,
        "key_value_usd": key_value,
        "link": _safe_text(entry.get("link")),
        "source": source,
    }
