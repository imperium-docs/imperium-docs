from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from config import STATE_PATH, STATE_VERSION


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {"version": STATE_VERSION, "updated_at": _now(), "events": []}
    try:
        payload = json.loads(STATE_PATH.read_text(encoding="utf8"))
        if isinstance(payload, dict):
            if "events" in payload:
                return payload
            if "entries" in payload:
                converted = []
                for entry in payload.get("entries", []):
                    converted.append(
                        {
                            "event_id": entry.get("id"),
                            "url": entry.get("url"),
                            "added_at": entry.get("added_at"),
                            "published_at": entry.get("published_at"),
                        }
                    )
                return {
                    "version": payload.get("version", STATE_VERSION),
                    "updated_at": payload.get("updated_at", _now()),
                    "events": converted,
                }
            return payload
    except Exception:
        pass
    return {"version": STATE_VERSION, "updated_at": _now(), "events": []}


def update_state(state: dict[str, Any], new_items: list[dict[str, Any]]) -> dict[str, Any]:
    entries = list(state.get("events", []))
    for item in new_items:
        entries.append(
            {
                "event_id": item["id"],
                "url": item["canonical_url"],
                "added_at": _now(),
                "published_at": item["published_at"],
                "event_at": item.get("event_at"),
                "domains": sorted({source.get("domain") for source in item.get("sources", []) if source.get("domain")}),
            }
        )
    return {
        "version": state.get("version", STATE_VERSION),
        "updated_at": _now(),
        "events": entries,
    }


def write_state(state: dict[str, Any], path=STATE_PATH) -> None:
    path.write_text(json.dumps(state, indent=2), encoding="utf8")
