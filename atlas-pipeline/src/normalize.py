from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

from config import ALLOWED_EVENT_TYPES

NUMBER_RE = re.compile(r"([0-9][0-9,\.]*)\s*(trillion|tn|billion|bn|million|m)?", re.IGNORECASE)
TICKER_RE = re.compile(r"\(([A-Z]{1,5})\)")
PERIOD_RE = re.compile(r"\b(Q[1-4])\s*(20\d{2})\b", re.IGNORECASE)
FY_RE = re.compile(r"\b(FY)\s*(20\d{2})\b", re.IGNORECASE)
DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def parse_date(value: str | None) -> datetime:
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


def extract_ticker(text: str) -> str | None:
    match = TICKER_RE.search(text)
    if match:
        return match.group(1).upper()
    return None


def extract_period(text: str) -> str | None:
    match = PERIOD_RE.search(text)
    if match:
        return f"{match.group(1).upper()} {match.group(2)}"
    match = FY_RE.search(text)
    if match:
        return f"FY{match.group(2)}"
    return None


def infer_event_at(text: str, published_at: str | None) -> str:
    match = DATE_RE.search(text)
    if match:
        return f"{match.group(1)}T00:00:00+00:00"
    published = parse_date(published_at or "")
    return published.isoformat()


def stable_event_id(
    event_type: str,
    entity: str,
    event_at: str,
    key_value: float | None,
    period: str | None,
    ticker: str | None,
) -> str:
    key = "" if key_value is None else f"{key_value:.2f}"
    raw = f"{event_type}|{entity}|{event_at}|{key}|{period or ''}|{ticker or ''}"
    return hashlib.sha1(raw.encode("utf8")).hexdigest()[:16]


def normalize_candidate(payload: dict[str, Any], extracted: dict[str, Any]) -> dict[str, Any]:
    source = payload["source"]
    title = _safe_text(extracted.get("title") or payload.get("title"))
    summary = _safe_text(payload.get("summary"))
    content = _safe_text(extracted.get("text"))
    published_at = extracted.get("published_at") or payload.get("published_at")
    published_at_iso = parse_date(_safe_text(published_at)).isoformat()
    raw_text = " ".join([title, summary, content])
    event_type = classify_event(raw_text)
    if event_type not in ALLOWED_EVENT_TYPES:
        event_type = "revenue_record"
    entity = derive_entity_name(title, source.name)
    key_value = extract_key_value_usd(raw_text)
    period = extract_period(raw_text)
    ticker = extract_ticker(raw_text)
    event_at = infer_event_at(raw_text, published_at_iso)
    event_id = stable_event_id(event_type, entity, event_at[:10], key_value, period, ticker)
    return {
        "event_id": event_id,
        "event_type": event_type,
        "category_label": classify_label(event_type),
        "entity": entity,
        "title": title or entity,
        "summary": summary or title or entity,
        "content": content,
        "published_at": published_at_iso,
        "event_at": event_at,
        "period": period,
        "ticker": ticker,
        "key_value_usd": key_value,
        "link": extracted.get("canonical_url") or payload.get("url"),
        "source": source,
        "extraction": {
            "method": extracted.get("extraction_method"),
            "paywalled": bool(extracted.get("paywalled")),
            "body_length": len(content),
        },
    }
