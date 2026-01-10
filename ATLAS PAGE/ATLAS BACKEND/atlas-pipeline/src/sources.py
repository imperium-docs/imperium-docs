from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from config import CANONICAL_DOMAINS, SOURCES_PATH


@dataclass(frozen=True)
class SourceConfig:
    id: str
    name: str
    tier: str
    is_primary: bool
    method: str
    feed_url: str
    url: str
    domain: str
    selectors: dict[str, Any] | None
    priority: int
    category_hints: list[str]


def _domain_from_url(value: str) -> str:
    try:
        hostname = urlparse(value).hostname or ""
        if hostname.startswith("www."):
            hostname = hostname[4:]
        return hostname
    except Exception:
        return ""


def load_sources(path: Path | None = None) -> list[SourceConfig]:
    target = path or SOURCES_PATH
    raw = json.loads(target.read_text(encoding="utf8"))
    items = raw.get("sources", raw if isinstance(raw, list) else [])
    sources: list[SourceConfig] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        feed_url = str(item.get("feed_url") or "")
        url = str(item.get("url") or feed_url)
        domain = _domain_from_url(str(item.get("domain") or url or feed_url))
        if domain and domain not in CANONICAL_DOMAINS:
            print(f"[sources] skipping non-canonical domain: {domain}")
            continue
        tier = str(item.get("tier") or "secondary")
        is_primary = bool(item.get("is_primary")) if "is_primary" in item else tier == "primary"
        selectors = item.get("selectors") if isinstance(item.get("selectors"), dict) else None
        hints = item.get("category_hints") or item.get("categories") or []
        if isinstance(hints, str):
            hints = [hints]
        sources.append(
            SourceConfig(
                id=str(item.get("id") or feed_url or url),
                name=str(item.get("name") or item.get("id") or "Unknown"),
                tier=tier,
                is_primary=is_primary,
                method=str(item.get("method") or "rss"),
                feed_url=feed_url,
                url=url,
                domain=domain,
                selectors=selectors,
                priority=int(item.get("priority") or 0),
                category_hints=[str(hint) for hint in hints],
            )
        )
    return sources


def sources_by_id(sources: list[SourceConfig]) -> dict[str, SourceConfig]:
    return {source.id: source for source in sources}


def sources_by_domain(sources: list[SourceConfig]) -> dict[str, SourceConfig]:
    mapping: dict[str, SourceConfig] = {}
    for source in sources:
        if source.domain:
            mapping[source.domain] = source
    return mapping
