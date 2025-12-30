from __future__ import annotations

from typing import Any


def filter_new_entries(items: list[dict[str, Any]], state: dict[str, Any]) -> list[dict[str, Any]]:
    known_urls = {entry.get("url") for entry in state.get("entries", []) if entry.get("url")}
    known_ids = {entry.get("id") for entry in state.get("entries", []) if entry.get("id")}
    fresh: list[dict[str, Any]] = []
    for item in items:
        link = item.get("link")
        event_id = item.get("event_id")
        if link in known_urls or event_id in known_ids:
            continue
        fresh.append(item)
    return fresh
