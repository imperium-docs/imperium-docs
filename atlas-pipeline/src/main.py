from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from config import FEED_PATH, FEED_VERSION, LOG_DIR, MAX_ITEMS, STATE_PATH, WINDOW_HOURS
from dedup import filter_new_entries
from extractor import extract_content, fetch_url
from ingest import ingest_sources
from judge import apply_thematic_filter, cluster_events, judge_clusters
from normalize import normalize_candidate
from rank import rank_events
from render import render_event
from schema import validate_feed_payload, validate_state_payload
from sources import load_sources
from state import load_state, update_state, write_state


def write_feed(feed: dict, path: Path) -> None:
    path.write_text(json.dumps(feed, indent=2), encoding="utf8")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_candidates(candidates: list[dict]) -> list[dict]:
    extracted_items: list[dict] = []
    for candidate in candidates:
        url = candidate.get("url")
        if not url:
            continue
        try:
            response = fetch_url(url)
            extracted = extract_content(url, response.text)
            extracted_items.append(
                normalize_candidate(
                    candidate,
                    {
                        "title": extracted.title,
                        "canonical_url": extracted.canonical_url,
                        "published_at": extracted.published_at or candidate.get("published_at"),
                        "text": extracted.text,
                        "extraction_method": extracted.extraction_method,
                        "paywalled": extracted.paywalled,
                    },
                )
            )
        except Exception as exc:
            print(f"[extract] {url}: failed ({exc})")
    return extracted_items


def _select_by_windows(items: list[dict]) -> tuple[list[dict], dict[str, str]]:
    selected: list[dict] = []
    decisions: dict[str, str] = {}
    grouped: dict[str, list[dict]] = {}
    for item in items:
        grouped.setdefault(item["event_type"], []).append(item)

    for event_type, events in grouped.items():
        narrowed = [event for event in events if event.get("window") == "narrow"]
        medium = [event for event in events if event.get("window") == "medium"]
        long = [event for event in events if event.get("window") == "long"]
        pick: dict | None = None
        if narrowed:
            pick = narrowed[0]
            decisions[event_type] = "narrow_window"
        elif medium:
            pick = medium[0]
            decisions[event_type] = "medium_window"
        elif long:
            pick = long[0]
            decisions[event_type] = "long_window"
        else:
            decisions[event_type] = "no_candidate"
        if pick:
            selected.append(pick)

    return selected, decisions


def _write_log(payload: dict) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = LOG_DIR / f"run-{stamp}.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf8")


def main() -> int:
    print("[atlas] loading sources")
    sources = load_sources()

    print(f"[atlas] sources: {len(sources)}")
    raw_entries = ingest_sources(sources)
    extracted = _extract_candidates(raw_entries)

    state = load_state()
    fresh = filter_new_entries(extracted, state)
    themed, theme_rejected = apply_thematic_filter(fresh)
    clusters = cluster_events(themed)
    approved, rejected = judge_clusters(clusters)
    ranked = rank_events(approved)
    selected, window_decisions = _select_by_windows(ranked)

    print(
        "[atlas] candidates:",
        len(extracted),
        "fresh:",
        len(fresh),
        "themed:",
        len(themed),
        "clusters:",
        len(clusters),
        "approved:",
        len(approved),
        "selected:",
        len(selected),
        "rejected:",
        len(rejected) + len(theme_rejected),
    )
    for decision in theme_rejected:
        print(f"[atlas] reject {decision.get('event_id')}: {decision.get('rejection_reason')}")
    for decision in rejected:
        print(f"[atlas] reject {decision['event_id']}: {decision.get('rejection_reason')}")

    feed_items = [render_event(event) for event in selected][:MAX_ITEMS]
    feed = {
        "version": FEED_VERSION,
        "generated_at": _now(),
        "items": feed_items,
    }
    errors = validate_feed_payload(feed)
    if errors:
        raise RuntimeError(f"feed schema invalid: {errors}")

    next_state = update_state(state, feed_items)
    state_errors = validate_state_payload(next_state)
    if state_errors:
        raise RuntimeError(f"state schema invalid: {state_errors}")

    write_feed(feed, FEED_PATH)
    write_state(next_state)
    print(f"[atlas] wrote feed: {FEED_PATH}")

    _write_log(
        {
            "generated_at": feed["generated_at"],
            "source_count": len(sources),
            "candidate_count": len(extracted),
            "selected_count": len(feed_items),
            "windows": window_decisions,
            "rejections": {
                "theme": len(theme_rejected),
                "evidence": len(rejected),
            },
            "window_hours": WINDOW_HOURS,
        }
    )

    if not feed_items:
        print("[atlas] no-op: no approved events")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
