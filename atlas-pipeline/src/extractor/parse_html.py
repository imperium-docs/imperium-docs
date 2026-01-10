from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from bs4 import BeautifulSoup


@dataclass(frozen=True)
class ParsedBody:
    text: str
    method: str
    paywalled: bool


def _clean_text(value: str) -> str:
    return " ".join(value.split()).strip()


def _is_paywalled(text: str) -> bool:
    lowered = text.lower()
    if len(text) < 400:
        return True
    return any(
        token in lowered
        for token in [
            "subscribe",
            "sign in",
            "register to continue",
            "to continue reading",
            "already a subscriber",
            "account required",
        ]
    )


def _extract_trafilatura(html: str, url: str | None) -> str | None:
    try:
        import trafilatura  # type: ignore
    except Exception:
        return None
    try:
        return trafilatura.extract(html, url=url, include_comments=False, include_tables=False) or None
    except Exception:
        return None


def _extract_readability(html: str) -> str | None:
    try:
        from readability import Document  # type: ignore
    except Exception:
        return None
    try:
        summary_html = Document(html).summary()
        soup = BeautifulSoup(summary_html, "lxml")
        return soup.get_text(" ", strip=True) or None
    except Exception:
        return None


def _extract_bs4(html: str) -> str | None:
    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    text = soup.get_text(" ", strip=True)
    return text or None


def parse_html(html: str, *, url: str | None = None) -> ParsedBody:
    text = _extract_trafilatura(html, url)
    if text:
        cleaned = _clean_text(text)
        return ParsedBody(text=cleaned, method="trafilatura", paywalled=_is_paywalled(cleaned))

    text = _extract_readability(html)
    if text:
        cleaned = _clean_text(text)
        return ParsedBody(text=cleaned, method="readability", paywalled=_is_paywalled(cleaned))

    text = _extract_bs4(html) or ""
    cleaned = _clean_text(text)
    return ParsedBody(text=cleaned, method="bs4", paywalled=_is_paywalled(cleaned))
