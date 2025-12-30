from __future__ import annotations

from typing import Any

from config import ALLOWED_EVENT_TYPES
from evidence import evidence_passes, summarize_evidence


def cluster_events(items: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    clusters: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        event_id = item["event_id"]
        clusters.setdefault(event_id, []).append(item)
    return clusters


def judge_clusters(clusters: dict[str, list[dict[str, Any]]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    approved: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for event_id, items in clusters.items():
        event_type = items[0]["event_type"]
        summary = summarize_evidence(items)
        decision = {
            "event_id": event_id,
            "event_type": event_type,
            "entity": items[0]["entity"],
            "items": items,
            "evidence": summary,
        }
        if event_type not in ALLOWED_EVENT_TYPES:
            decision["rejection_reason"] = "unsupported_type"
            rejected.append(decision)
            continue
        if not evidence_passes(summary):
            decision["rejection_reason"] = "insufficient_evidence"
            rejected.append(decision)
            continue
        approved.append(decision)
    return approved, rejected
