from __future__ import annotations

from evidence import build_evidence_pack


class Source:
    def __init__(self, domain: str, is_primary: bool):
        self.domain = domain
        self.is_primary = is_primary


def _item(domain: str, is_primary: bool, text: str):
    return {
        "link": f"https://{domain}/a",
        "title": "Example IPO filed",
        "published_at": "2025-01-01T00:00:00Z",
        "content": text,
        "source": Source(domain, is_primary),
    }


def test_evidence_distinct_domains_rule():
    items = [
        _item("sec.gov", True, "Company filed for an IPO in 2025 with the SEC registration statement."),
        _item("nasdaq.com", False, "The issuer filed for an IPO and outlined a 2025 listing plan."),
        _item("reuters.com", False, "Reuters reports the IPO filing and exchange listing timeline."),
    ]
    summary = build_evidence_pack(items, event_type="ipo", key_value_usd=None, period=None, ticker=None)
    assert summary.passes
