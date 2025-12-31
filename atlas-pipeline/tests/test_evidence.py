from __future__ import annotations

from evidence import evidence_passes, summarize_evidence


class Source:
    def __init__(self, tier: str):
        self.tier = tier


def test_evidence_total_sources_rule():
    items = [{"source": Source("secondary")} for _ in range(5)]
    summary = summarize_evidence(items)
    assert summary.total == 5
    assert evidence_passes(summary)


def test_evidence_primary_secondary_rule():
    items = [
        {"source": Source("primary")},
        {"source": Source("primary")},
        {"source": Source("secondary")},
        {"source": Source("secondary")},
        {"source": Source("secondary")},
    ]
    summary = summarize_evidence(items)
    assert evidence_passes(summary)
