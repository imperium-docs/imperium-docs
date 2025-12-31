from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from config import STATE_PATH


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {"version": 1, "updated_at": _now(), "entries": []}
    try:
        payload = json.loads(STATE_PATH.read_text(encoding="utf8"))
        if isinstance(payload, dict):
            return payload
    except Exception:
        pass
    return {"version": 1, "updated_at": _now(), "entries": []}


def update_state(state: dict[str, Any], new_items: list[dict[str, Any]]) -> dict[str, Any]:
    entries = list(state.get("entries", []))
    for item in new_items:
        entries.append(
            {
                "url": item["canonical_url"],
                "id": item["id"],
                "added_at": _now(),
                "published_at": item["published_at"],
            }
        )
    return {
        "version": state.get("version", 1),
        "updated_at": _now(),
        "entries": entries,
    }


def write_state(state: dict[str, Any], path=STATE_PATH) -> None:
    path.write_text(json.dumps(state, indent=2), encoding="utf8")
