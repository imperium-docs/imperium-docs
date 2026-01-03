from __future__ import annotations

from schema import validate_feed_payload, validate_state_payload


def test_schema_accepts_minimal_payloads():
    feed = {
        "version": 4,
        "generated_at": "2025-01-01T00:00:00Z",
        "items": [
            {
                "id": "abc",
                "signal_type": "ipo",
                "event_type": "ipo",
                "entity": "Example",
                "title": "Example IPO",
                "summary": "Example summary",
                "canonical_url": "https://example.com",
                "published_at": "2025-01-01T00:00:00Z",
                "event_at": "2025-01-01T00:00:00Z",
                "sources": [],
                "evidence_pack": {"sources": [], "excerpts": [], "claims": []},
            }
        ],
    }
    state = {
        "version": 4,
        "updated_at": "2025-01-01T00:00:00Z",
        "events": [{"url": "https://example.com", "event_id": "abc", "added_at": "2025-01-01T00:00:00Z"}],
    }
    assert validate_feed_payload(feed) == []
    assert validate_state_payload(state) == []
