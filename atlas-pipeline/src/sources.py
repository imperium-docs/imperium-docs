from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from config import SOURCES_PATH


@dataclass(frozen=True)
class SourceConfig:
    id: str
    name: str
    tier: str
    method: str
    feed_url: str
    domain: str


def _domain_from_url(value: str) -> str:
    try:
        return urlparse(value).hostname or ""
    except Exception:
        return ""


def load_sources(path: Path | None = None) -> list[SourceConfig]:
    target = path or SOURCES_PATH
    raw = json.loads(target.read_text(encoding="utf8"))
    items = raw.get("sources", [])
    sources: list[SourceConfig] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        feed_url = str(item.get("feed_url") or "")
        sources.append(
            SourceConfig(
                id=str(item.get("id") or feed_url),
                name=str(item.get("name") or item.get("id") or "Unknown"),
                tier=str(item.get("tier") or "secondary"),
                method=str(item.get("method") or "rss"),
                feed_url=feed_url,
                domain=_domain_from_url(feed_url),
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
