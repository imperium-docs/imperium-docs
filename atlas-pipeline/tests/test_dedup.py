from __future__ import annotations

from dedup import filter_new_entries


def test_dedup_filters_known_url_and_id():
    state = {"events": [{"url": "https://example.com/a", "event_id": "id-1"}]}
    items = [
        {"link": "https://example.com/a", "event_id": "id-2"},
        {"link": "https://example.com/b", "event_id": "id-1"},
        {"link": "https://example.com/c", "event_id": "id-3"},
    ]
    fresh = filter_new_entries(items, state)
    assert len(fresh) == 1
    assert fresh[0]["link"] == "https://example.com/c"
