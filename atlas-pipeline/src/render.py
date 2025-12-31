from __future__ import annotations

from typing import Any

def _safe(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _deterministic_body(event: dict[str, Any]) -> tuple[str, str, str, list[str]]:
    headline = f"{event['entity']} - {event['event_type'].upper()}"
    summary = event["items"][0]["summary"]
    sources = ", ".join({item["source"].name for item in event["items"]})
    body = f"{summary}\n\nEvidence sources: {sources}."
    checklist = [
        "event_type_valid",
        "evidence_minimum_met",
        "deduplicated",
    ]
    return headline, summary, body, checklist


def render_event(event: dict[str, Any]) -> dict[str, Any]:
    title, summary, body, checklist = _deterministic_body(event)
    main_item = event["items"][0]
    theme = event["event_type"].upper()
    return {
        "id": event["event_id"],
        "signal_type": event["event_type"],
        "theme": theme,
        "category_label": main_item["category_label"],
        "title": _safe(title),
        "summary": _safe(summary),
        "body": _safe(body),
        "sector": "finance",
        "canonical_url": _safe(main_item["link"]),
        "source": main_item["source"].name,
        "date": main_item["published_at"],
        "link": _safe(main_item["link"]),
        "source_name": main_item["source"].name,
        "facts": [item["title"] for item in event["items"]][:5],
        "evidences": event.get("evidences", []),
        "entities": {
            "name": event["entity"],
            "type": "company",
            "sector": "finance",
        },
        "metrics": {
            "amount_usd": main_item.get("key_value_usd"),
        },
        "published_at": main_item["published_at"],
        "event_date": main_item["event_date"],
        "sources": [
            {
                "url": item["link"],
                "domain": item["source"].domain,
                "kind": item["source"].tier,
                "weight": 1 if item["source"].tier == "primary" else 0.6,
                "published_at": item["published_at"],
            }
            for item in event["items"]
        ],
        "evidence": {
            "total": event["evidence"].total,
            "primary": event["evidence"].primary,
            "secondary": event["evidence"].secondary,
            "research": event["evidence"].research,
        },
        "checklist": checklist,
    }
