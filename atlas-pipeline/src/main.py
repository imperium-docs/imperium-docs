from __future__ import annotations

import json
from datetime import datetime, timezone

from config import (
    CONTENT_FEED_PATH,
    CONTENT_STATE_PATH,
    FEED_PATH,
    MAX_ITEMS,
    SOURCES_PATH,
    SYNC_CONTENT_ATLAS,
)
from dedup import filter_new_entries
from ingest import ingest_sources
from judge import apply_thematic_filter, cluster_events, judge_clusters
from normalize import normalize_entry
from rank import rank_events
from render import render_event
from schema import validate_feed_payload, validate_state_payload
from sources import load_sources
from state import load_state, update_state, write_state


def write_feed(feed: dict, path) -> None:
    path.write_text(json.dumps(feed, indent=2), encoding="utf8")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    print("[atlas] loading sources")
    sources = load_sources(SOURCES_PATH)
    rss_sources = [source for source in sources if source.method == "rss" and source.feed_url]

    print(f"[atlas] sources: {len(rss_sources)}")
    raw_entries = ingest_sources(rss_sources)
    normalized = [normalize_entry(entry) for entry in raw_entries]

    state = load_state()
    fresh = filter_new_entries(normalized, state)
    themed, theme_rejected = apply_thematic_filter(fresh)
    clusters = cluster_events(themed)
    approved, rejected = judge_clusters(clusters)
    ranked = rank_events(approved)

    print(
        "[atlas] candidates:",
        len(normalized),
        "fresh:",
        len(fresh),
        "themed:",
        len(themed),
        "clusters:",
        len(clusters),
        "approved:",
        len(approved),
        "rejected:",
        len(rejected) + len(theme_rejected),
    )
    for decision in theme_rejected:
        print(f"[atlas] reject {decision.get('event_id')}: {decision.get('rejection_reason')}")
    for decision in rejected:
        print(f"[atlas] reject {decision['event_id']}: {decision.get('rejection_reason')}")

    feed_items = [render_event(event) for event in ranked][:MAX_ITEMS]
    feed = {
        "version": 4,
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

    if SYNC_CONTENT_ATLAS:
        CONTENT_FEED_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONTENT_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        write_feed(feed, CONTENT_FEED_PATH)
        write_state(next_state, CONTENT_STATE_PATH)
        print("[atlas] synced content/atlas outputs")

    print(f"[atlas] total items: {len(feed_items)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
