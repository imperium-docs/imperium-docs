from __future__ import annotations

from typing import Any


def _is_str(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def validate_feed_payload(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["payload is not a dict"]
    if payload.get("version") is None:
        errors.append("missing version")
    if not _is_str(payload.get("generated_at")):
        errors.append("missing generated_at")
    items = payload.get("items")
    if not isinstance(items, list):
        errors.append("items is not a list")
        return errors
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"item {idx} not a dict")
            continue
        for field in ("id", "signal_type", "title", "summary", "canonical_url", "published_at"):
            if not _is_str(item.get(field)):
                errors.append(f"item {idx} missing {field}")
        sources = item.get("sources")
        if not isinstance(sources, list):
            errors.append(f"item {idx} sources not list")
    return errors


def validate_state_payload(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["payload is not a dict"]
    if payload.get("version") is None:
        errors.append("missing version")
    if not _is_str(payload.get("updated_at")):
        errors.append("missing updated_at")
    entries = payload.get("entries")
    if not isinstance(entries, list):
        errors.append("entries is not a list")
        return errors
    for idx, entry in enumerate(entries):
        if not isinstance(entry, dict):
            errors.append(f"entry {idx} not dict")
            continue
        for field in ("url", "id", "added_at"):
            if not _is_str(entry.get(field)):
                errors.append(f"entry {idx} missing {field}")
    return errors
