from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse


@dataclass(frozen=True)
class EvidenceSource:
    domain: str
    url: str
    title: str
    published_at: str | None
    is_primary: bool


@dataclass(frozen=True)
class EvidenceExcerpt:
    url: str
    domain: str
    quote: str


@dataclass(frozen=True)
class EvidenceClaim:
    field: str
    value: str
    source_url: str


@dataclass(frozen=True)
class EvidencePack:
    sources: list[EvidenceSource]
    excerpts: list[EvidenceExcerpt]
    claims: list[EvidenceClaim]
    distinct_domains: int
    primary_domains: int
    secondary_domains: int
    policy_id: str
    passes: bool
    reasons: list[str]


POLICY_BY_TYPE: dict[str, dict[str, int]] = {
    "ipo": {"min_domains": 4, "min_primary": 1, "min_secondary": 2},
    "billionaire": {"min_domains": 3, "min_primary": 1, "min_secondary": 1},
    "revenue_record": {"min_domains": 4, "min_primary": 1, "min_secondary": 2},
}


def _domain(url: str) -> str:
    hostname = urlparse(url).hostname or ""
    return hostname[4:] if hostname.startswith("www.") else hostname


def _split_sentences(text: str) -> list[str]:
    raw = text.replace("\n", " ")
    parts = [chunk.strip() for chunk in raw.replace("!", ".").replace("?", ".").split(".")]
    return [part for part in parts if len(part) > 20]


def _extract_excerpts(text: str, keywords: list[str], max_count: int = 3) -> list[str]:
    sentences = _split_sentences(text)
    excerpts: list[str] = []
    for sentence in sentences:
        lowered = sentence.lower()
        if any(keyword in lowered for keyword in keywords):
            excerpts.append(sentence.strip())
        if len(excerpts) >= max_count:
            break
    return excerpts


def _keywords_for_type(event_type: str) -> list[str]:
    if event_type == "ipo":
        return ["ipo", "listed", "listing", "filed", "prospectus", "registration", "priced"]
    if event_type == "billionaire":
        return ["billionaire", "net worth", "billion"]
    return ["record revenue", "highest revenue", "all-time", "revenue"]


def build_evidence_pack(
    items: list[dict[str, Any]],
    *,
    event_type: str,
    key_value_usd: float | None,
    period: str | None,
    ticker: str | None,
) -> EvidencePack:
    sources: list[EvidenceSource] = []
    excerpts: list[EvidenceExcerpt] = []
    claims: list[EvidenceClaim] = []
    domains: set[str] = set()
    primary_domains: set[str] = set()
    secondary_domains: set[str] = set()
    keywords = _keywords_for_type(event_type)

    for item in items:
        url = item.get("link") or ""
        domain = item.get("source").domain if item.get("source") else _domain(url)
        is_primary = bool(getattr(item.get("source"), "is_primary", False))
        title = item.get("title") or ""
        published_at = item.get("published_at")
        if not domain or not url:
            continue
        domains.add(domain)
        if is_primary:
            primary_domains.add(domain)
        else:
            secondary_domains.add(domain)
        sources.append(
            EvidenceSource(
                domain=domain,
                url=url,
                title=title,
                published_at=published_at,
                is_primary=is_primary,
            )
        )

        text = item.get("content") or ""
        for quote in _extract_excerpts(text, keywords, max_count=2):
            excerpts.append(EvidenceExcerpt(url=url, domain=domain, quote=quote))

    if key_value_usd is not None and sources:
        claims.append(
            EvidenceClaim(field="key_value_usd", value=f"{key_value_usd:.2f}", source_url=sources[0].url)
        )
    if period and sources:
        claims.append(EvidenceClaim(field="period", value=period, source_url=sources[0].url))
    if ticker and sources:
        claims.append(EvidenceClaim(field="ticker", value=ticker, source_url=sources[0].url))

    policy = POLICY_BY_TYPE.get(event_type, {"min_domains": 4, "min_primary": 1, "min_secondary": 2})
    reasons: list[str] = []
    distinct_domains = len(domains)
    if distinct_domains >= policy["min_domains"]:
        reasons.append("distinct_domains_met")
    if len(primary_domains) >= policy["min_primary"] and len(secondary_domains) >= policy["min_secondary"]:
        reasons.append("primary_secondary_mix_met")
    if excerpts:
        reasons.append("excerpts_present")
    if claims:
        reasons.append("claims_present")

    passes = (
        (distinct_domains >= policy["min_domains"])
        or (len(primary_domains) >= policy["min_primary"] and len(secondary_domains) >= policy["min_secondary"])
    ) and bool(excerpts)

    return EvidencePack(
        sources=sources,
        excerpts=excerpts,
        claims=claims,
        distinct_domains=distinct_domains,
        primary_domains=len(primary_domains),
        secondary_domains=len(secondary_domains),
        policy_id=event_type,
        passes=passes,
        reasons=reasons,
    )
