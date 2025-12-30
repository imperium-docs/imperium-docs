from __future__ import annotations

from typing import Any

from llm import generate


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
    try:
        llm_payload = generate(event)
    except Exception as exc:
        print(f"[llm] fallback to deterministic output ({exc})")
        llm_payload = None
    if llm_payload and llm_payload.title and llm_payload.body:
        title = llm_payload.title
        summary = llm_payload.dek or event["items"][0]["summary"]
        body = llm_payload.body
        checklist = llm_payload.checklist
    else:
        title, summary, body, checklist = _deterministic_body(event)

    main_item = event["items"][0]
    return {
        "id": event["event_id"],
        "signal_type": event["event_type"],
        "category_label": main_item["category_label"],
        "title": _safe(title),
        "summary": _safe(summary),
        "body": _safe(body),
        "sector": "finance",
        "canonical_url": _safe(main_item["link"]),
        "source_name": main_item["source"].name,
        "facts": [item["title"] for item in event["items"]][:5],
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
