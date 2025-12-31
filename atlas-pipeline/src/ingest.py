from __future__ import annotations

import time
from typing import Any

import feedparser
import requests
from xml.etree import ElementTree

from config import MAX_PER_SOURCE, USER_AGENT
from sources import SourceConfig


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _extract_entry(entry: Any) -> dict[str, Any]:
    title = _safe_text(getattr(entry, "title", ""))
    summary = _safe_text(getattr(entry, "summary", "")) or _safe_text(getattr(entry, "description", ""))
    link = _safe_text(getattr(entry, "link", "")) or _safe_text(getattr(entry, "id", ""))
    published = _safe_text(getattr(entry, "published", "")) or _safe_text(getattr(entry, "updated", ""))
    content = ""
    raw_content = getattr(entry, "content", None)
    if isinstance(raw_content, list) and raw_content:
        content = _safe_text(raw_content[0].get("value"))
    elif isinstance(raw_content, dict):
        content = _safe_text(raw_content.get("value"))
    return {
        "title": title,
        "summary": summary,
        "content": content,
        "link": link,
        "published": published,
    }


def fetch_source_entries(source: SourceConfig) -> list[dict[str, Any]]:
    if source.method not in ("rss", "sitemap") or not source.feed_url:
        return []
    response = requests.get(
        source.feed_url,
        headers={"User-Agent": USER_AGENT},
        timeout=25,
    )
    response.raise_for_status()
    if source.method == "sitemap":
        return _parse_sitemap(response.text)[:MAX_PER_SOURCE]
    parsed = feedparser.parse(response.text)
    entries = parsed.entries or []
    sliced = entries[:MAX_PER_SOURCE]
    return [_extract_entry(entry) for entry in sliced]


def _parse_sitemap(xml_text: str) -> list[dict[str, Any]]:
    try:
        root = ElementTree.fromstring(xml_text)
    except Exception:
        return []
    entries: list[dict[str, Any]] = []
    for url in root.findall(".//{*}url"):
        loc = url.findtext("{*}loc") or ""
        if not loc:
            continue
        entries.append(
            {
                "title": "",
                "summary": "",
                "content": "",
                "link": loc.strip(),
                "published": "",
            }
        )
    return entries


def ingest_sources(sources: list[SourceConfig]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for source in sources:
        try:
            start = time.time()
            entries = fetch_source_entries(source)
            for entry in entries:
                results.append({"source": source, "entry": entry})
            duration = time.time() - start
            print(f"[ingest] {source.id}: {len(entries)} entries in {duration:.2f}s")
        except Exception as exc:
            print(f"[ingest] {source.id}: failed ({exc})")
    return results
