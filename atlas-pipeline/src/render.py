from __future__ import annotations

from typing import Any


def _safe(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _deterministic_summary(event: dict[str, Any]) -> tuple[str, str]:
    main_item = event["items"][0]
    title = f"{event['entity']} - {event['event_type'].upper()}"
    summary = main_item.get("summary") or main_item.get("title") or event["entity"]
    return title, summary


def _confidence(event: dict[str, Any]) -> float:
    score = event.get("score", {})
    total = score.get("total", 0.0) or 0.0
    if total >= 4.0:
        return 0.9
    if total >= 3.0:
        return 0.8
    if total >= 2.0:
        return 0.7
    return 0.6


def render_event(event: dict[str, Any]) -> dict[str, Any]:
    title, summary = _deterministic_summary(event)
    main_item = event["items"][0]
    evidence = event["evidence"]
    sources_pack = [
        {
            "domain": source.domain,
            "url": source.url,
            "title": source.title,
            "published_at": source.published_at,
            "is_primary": source.is_primary,
        }
        for source in evidence.sources
    ]
    excerpts = [
        {"url": excerpt.url, "domain": excerpt.domain, "quote": excerpt.quote}
        for excerpt in evidence.excerpts
    ]
    claims = [
        {"field": claim.field, "value": claim.value, "source_url": claim.source_url}
        for claim in evidence.claims
    ]

    return {
        "id": event["event_id"],
        "signal_type": event["event_type"],
        "event_type": event["event_type"],
        "entity": event["entity"],
        "title": _safe(title),
        "summary": _safe(summary),
        "canonical_url": _safe(main_item.get("link")),
        "published_at": _safe(main_item.get("published_at")),
        "event_at": _safe(main_item.get("event_at")),
        "key_value_usd": main_item.get("key_value_usd"),
        "period": main_item.get("period"),
        "ticker": main_item.get("ticker"),
        "sources": sources_pack,
        "evidence_pack": {
            "sources": sources_pack,
            "excerpts": excerpts,
            "claims": claims,
        },
        "evidence": {
            "distinct_domains": evidence.distinct_domains,
            "primary_domains": evidence.primary_domains,
            "secondary_domains": evidence.secondary_domains,
            "policy_id": evidence.policy_id,
            "reasons": evidence.reasons,
            "passes": evidence.passes,
        },
        "checklist": [
            "event_type_valid",
            "evidence_pack_present",
            "distinct_domains_enforced",
            "deduplicated",
        ],
        "confidence": _confidence(event),
    }
