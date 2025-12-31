from __future__ import annotations

from typing import Any

from config import ALLOWED_EVENT_TYPES
from evidence import evidence_passes, summarize_evidence
from llm import verify_theme
from normalize import classify_label, stable_event_id
from theme_filter import evaluate_theme


def apply_thematic_filter(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    approved: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for item in items:
        decision = evaluate_theme(item.get("title", ""), item.get("summary", ""), item.get("content", ""))
        if not decision:
            rejected.append(
                {
                    "event_id": item.get("event_id"),
                    "event_type": item.get("event_type"),
                    "entity": item.get("entity"),
                    "rejection_reason": "theme_filter_failed",
                }
            )
            continue
        item["event_type"] = decision.theme
        item["category_label"] = classify_label(decision.theme)
        item["evidences"] = decision.evidences
        item["event_id"] = stable_event_id(
            decision.theme,
            item.get("entity", ""),
            item.get("event_date", ""),
            item.get("key_value_usd"),
        )
        llm_result = verify_theme(item, decision.theme)
        if llm_result is False:
            rejected.append(
                {
                    "event_id": item.get("event_id"),
                    "event_type": decision.theme,
                    "entity": item.get("entity"),
                    "rejection_reason": "llm_verification_failed",
                }
            )
            continue
        approved.append(item)
    return approved, rejected


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
            "evidences": sorted({e for item in items for e in item.get("evidences", [])}),
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
