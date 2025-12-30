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
                "title": "Example IPO",
                "summary": "Example summary",
                "canonical_url": "https://example.com",
                "published_at": "2025-01-01T00:00:00Z",
                "sources": [],
            }
        ],
    }
    state = {
        "version": 1,
        "updated_at": "2025-01-01T00:00:00Z",
        "entries": [{"url": "https://example.com", "id": "abc", "added_at": "2025-01-01T00:00:00Z"}],
    }
    assert validate_feed_payload(feed) == []
    assert validate_state_payload(state) == []
