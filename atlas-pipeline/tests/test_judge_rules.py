from __future__ import annotations

from judge import judge_clusters


class Source:
    def __init__(self, tier: str):
        self.tier = tier


def _item(event_id: str, event_type: str, tier: str):
    return {
        "event_id": event_id,
        "event_type": event_type,
        "entity": "Example",
        "source": Source(tier),
    }


def test_judge_rejects_insufficient_evidence():
    clusters = {"e1": [_item("e1", "ipo", "primary")]}
    approved, rejected = judge_clusters(clusters)
    assert not approved
    assert rejected[0]["rejection_reason"] == "insufficient_evidence"


def test_judge_accepts_primary_secondary_rule():
    items = [
        _item("e1", "ipo", "primary"),
        _item("e1", "ipo", "primary"),
        _item("e1", "ipo", "secondary"),
        _item("e1", "ipo", "secondary"),
        _item("e1", "ipo", "secondary"),
    ]
    approved, rejected = judge_clusters({"e1": items})
    assert approved and not rejected
