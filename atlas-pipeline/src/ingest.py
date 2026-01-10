from __future__ import annotations

import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree

import feedparser
from bs4 import BeautifulSoup

from config import HTML_MAX_LINKS, MAX_PER_SOURCE, SITEMAP_MAX_LINKS, USER_AGENT
from extractor.fetch import fetch_url
from sources import SourceConfig


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _parse_datetime(value: str) -> str | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.isoformat()
    except Exception:
        pass
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.isoformat()
    except Exception:
        return None


def _domain(url: str) -> str:
    hostname = urlparse(url).hostname or ""
    return hostname[4:] if hostname.startswith("www.") else hostname


def _same_domain(url: str, domain: str) -> bool:
    hostname = _domain(url)
    return hostname == domain


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


def _parse_sitemap(xml_text: str) -> list[dict[str, Any]]:
    try:
        root = ElementTree.fromstring(xml_text)
    except Exception:
        return []
    entries: list[dict[str, Any]] = []
    for url in root.findall(".//{*}url"):
        loc = url.findtext("{*}loc") or ""
        lastmod = url.findtext("{*}lastmod") or ""
        if not loc:
            continue
        entries.append(
            {
                "title": "",
                "summary": "",
                "content": "",
                "link": loc.strip(),
                "published": lastmod.strip(),
            }
        )
    return entries


def _extract_html_candidates(source: SourceConfig, html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "lxml")
    selectors = source.selectors or {}
    items: list[tuple[str, str | None]] = []

    item_selector = selectors.get("item")
    link_selector = selectors.get("link")
    date_selector = selectors.get("date")

    if item_selector:
        for block in soup.select(item_selector):
            link_node = block.select_one(link_selector) if link_selector else block.find("a", href=True)
            if not link_node or not link_node.get("href"):
                continue
            link = str(link_node.get("href")).strip()
            date_text = None
            if date_selector:
                date_node = block.select_one(date_selector)
                date_text = date_node.get_text(" ", strip=True) if date_node else None
            items.append((link, date_text))
    elif link_selector:
        for node in soup.select(link_selector):
            href = node.get("href") if hasattr(node, "get") else None
            if not href and node.find("a", href=True):
                href = node.find("a", href=True).get("href")
            if not href:
                continue
            items.append((str(href).strip(), None))
    else:
        for node in soup.find_all("a", href=True):
            items.append((str(node.get("href")).strip(), None))

    seen: set[str] = set()
    candidates: list[dict[str, Any]] = []
    for href, date_text in items:
        if not href or href.startswith("#") or href.startswith("mailto:"):
            continue
        absolute = urljoin(source.url or source.feed_url, href)
        if source.domain and not _same_domain(absolute, source.domain):
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        candidates.append(
            {
                "title": "",
                "summary": "",
                "content": "",
                "link": absolute,
                "published": date_text or "",
            }
        )
        if len(candidates) >= HTML_MAX_LINKS:
            break
    return candidates


def fetch_source_entries(source: SourceConfig) -> list[dict[str, Any]]:
    if source.method == "rss" and source.feed_url:
        response = fetch_url(
            source.feed_url,
            headers={"User-Agent": USER_AGENT},
            timeout=25,
        )
        parsed = feedparser.parse(response.text)
        entries = parsed.entries or []
        sliced = entries[:MAX_PER_SOURCE]
        return [_extract_entry(entry) for entry in sliced]

    if source.method == "sitemap" and source.feed_url:
        response = fetch_url(
            source.feed_url,
            headers={"User-Agent": USER_AGENT},
            timeout=25,
        )
        return _parse_sitemap(response.text)[:SITEMAP_MAX_LINKS]

    if source.method == "html" and source.url:
        response = fetch_url(
            source.url,
            headers={"User-Agent": USER_AGENT},
            timeout=25,
        )
        return _extract_html_candidates(source, response.text)

    return []


def ingest_sources(sources: list[SourceConfig]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for source in sources:
        try:
            start = time.time()
            entries = fetch_source_entries(source)
            for entry in entries:
                published_at = _parse_datetime(_safe_text(entry.get("published")))
                results.append(
                    {
                        "source": source,
                        "url": _safe_text(entry.get("link")),
                        "title": _safe_text(entry.get("title")),
                        "summary": _safe_text(entry.get("summary")),
                        "published_at": published_at,
                        "discovered_at": datetime.now(timezone.utc).isoformat(),
                        "method": source.method,
                    }
                )
            duration = time.time() - start
            print(f"[ingest] {source.id}: {len(entries)} entries in {duration:.2f}s")
        except Exception as exc:
            print(f"[ingest] {source.id}: failed ({exc})")
    return results
