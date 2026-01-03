from __future__ import annotations

from judge import judge_clusters


class Source:
    def __init__(self, domain: str, is_primary: bool):
        self.domain = domain
        self.is_primary = is_primary


def _item(event_id: str, event_type: str, domain: str, is_primary: bool):
    return {
        "event_id": event_id,
        "event_type": event_type,
        "entity": "Example",
        "link": f"https://{domain}/news",
        "title": "Company filed for an IPO",
        "published_at": "2025-01-01T00:00:00Z",
        "content": "Company filed for an IPO in 2025 with a registration statement and listing plan.",
        "source": Source(domain, is_primary),
    }


def test_judge_rejects_insufficient_evidence():
    clusters = {"e1": [_item("e1", "ipo", "sec.gov", True)]}
    approved, rejected = judge_clusters(clusters)
    assert not approved
    assert rejected[0]["rejection_reason"] == "insufficient_evidence"


def test_judge_accepts_primary_secondary_rule():
    items = [
        _item("e1", "ipo", "sec.gov", True),
        _item("e1", "ipo", "nasdaq.com", False),
        _item("e1", "ipo", "reuters.com", False),
    ]
    approved, rejected = judge_clusters({"e1": items})
    assert approved and not rejected
