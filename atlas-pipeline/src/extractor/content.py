from __future__ import annotations

from dataclasses import dataclass

from .metadata import Metadata, extract_metadata
from .parse_html import ParsedBody, parse_html


@dataclass(frozen=True)
class ExtractedContent:
    url: str
    canonical_url: str
    title: str
    published_at: str | None
    author: str | None
    og_title: str | None
    og_description: str | None
    text: str
    extraction_method: str
    paywalled: bool


def extract_content(url: str, html: str) -> ExtractedContent:
    metadata: Metadata = extract_metadata(html, base_url=url)
    parsed: ParsedBody = parse_html(html, url=url)
    canonical = metadata.canonical_url or url
    title = metadata.title or metadata.og_title or canonical
    return ExtractedContent(
        url=url,
        canonical_url=canonical,
        title=title,
        published_at=metadata.published_at,
        author=metadata.author,
        og_title=metadata.og_title,
        og_description=metadata.og_description,
        text=parsed.text,
        extraction_method=parsed.method,
        paywalled=parsed.paywalled,
    )
