from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup


@dataclass(frozen=True)
class Metadata:
    title: str | None
    canonical_url: str | None
    published_at: str | None
    author: str | None
    og_title: str | None
    og_description: str | None


_PUBLISHED_META_NAMES = {
    "article:published_time",
    "article:modified_time",
    "article:published",
    "article:modified",
    "og:pubdate",
    "pubdate",
    "date",
    "dc.date",
    "dc.date.issued",
    "parsely-pub-date",
    "sailthru.date",
    "pdate",
}


def _parse_datetime(raw: str | None) -> str | None:
    if not raw:
        return None
    value = raw.strip()
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


def _meta_content(soup: BeautifulSoup, *, prop: str | None = None, name: str | None = None) -> str | None:
    if prop:
        tag = soup.find("meta", attrs={"property": prop})
        if tag and tag.get("content"):
            return str(tag.get("content")).strip()
    if name:
        tag = soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            return str(tag.get("content")).strip()
    return None


def extract_metadata(html: str, *, base_url: str | None = None) -> Metadata:
    soup = BeautifulSoup(html, "lxml")

    title = None
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    og_title = _meta_content(soup, prop="og:title")
    if og_title and not title:
        title = og_title

    og_description = _meta_content(soup, prop="og:description") or _meta_content(soup, name="description")

    canonical_url = None
    canonical_tag = soup.find("link", attrs={"rel": "canonical"})
    if canonical_tag and canonical_tag.get("href"):
        canonical_url = str(canonical_tag.get("href")).strip()
    if not canonical_url:
        canonical_url = _meta_content(soup, prop="og:url") or None
    if canonical_url and base_url:
        canonical_url = urljoin(base_url, canonical_url)

    published_raw = None
    for name in _PUBLISHED_META_NAMES:
        published_raw = _meta_content(soup, prop=name) or _meta_content(soup, name=name)
        if published_raw:
            break
    published_at = _parse_datetime(published_raw)

    author = _meta_content(soup, name="author") or _meta_content(soup, prop="article:author")
    if author:
        author = author.strip()

    return Metadata(
        title=title,
        canonical_url=canonical_url,
        published_at=published_at,
        author=author,
        og_title=og_title,
        og_description=og_description,
    )
