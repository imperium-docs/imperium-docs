from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import requests

from config import USER_AGENT

_CACHE: dict[str, "FetchResult"] = {}
_LAST_REQUEST: dict[str, float] = {}
_SESSION = requests.Session()

DEFAULT_TIMEOUT = 25
DEFAULT_RETRIES = 2
MIN_INTERVAL_PER_DOMAIN = 1.0


@dataclass(frozen=True)
class FetchResult:
    url: str
    final_url: str
    status: int
    content_type: str | None
    text: str
    bytes: int
    fetched_at: str
    from_cache: bool


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _domain(url: str) -> str:
    hostname = urlparse(url).hostname or ""
    return hostname[4:] if hostname.startswith("www.") else hostname


def _sleep_for_domain(domain: str) -> None:
    last = _LAST_REQUEST.get(domain)
    if last is None:
        return
    elapsed = time.time() - last
    if elapsed < MIN_INTERVAL_PER_DOMAIN:
        time.sleep(MIN_INTERVAL_PER_DOMAIN - elapsed)


def fetch_url(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: int = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
    allow_cached: bool = True,
) -> FetchResult:
    if allow_cached and url in _CACHE:
        cached = _CACHE[url]
        return FetchResult(
            url=cached.url,
            final_url=cached.final_url,
            status=cached.status,
            content_type=cached.content_type,
            text=cached.text,
            bytes=cached.bytes,
            fetched_at=cached.fetched_at,
            from_cache=True,
        )

    domain = _domain(url)
    _sleep_for_domain(domain)

    request_headers: dict[str, str] = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    if headers:
        request_headers.update(headers)

    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            if attempt:
                time.sleep(0.8 * attempt)
            response = _SESSION.get(url, headers=request_headers, timeout=timeout, allow_redirects=True)
            _LAST_REQUEST[domain] = time.time()
            if response.status_code >= 500 or response.status_code == 429:
                last_error = RuntimeError(f"HTTP {response.status_code}")
                continue
            response.raise_for_status()
            text = response.text or ""
            result = FetchResult(
                url=url,
                final_url=str(response.url),
                status=response.status_code,
                content_type=response.headers.get("content-type"),
                text=text,
                bytes=len(text.encode("utf8")),
                fetched_at=_now(),
                from_cache=False,
            )
            _CACHE[url] = result
            return result
        except Exception as exc:
            last_error = exc

    raise RuntimeError(f"fetch failed for {url}: {last_error}")


def reset_fetch_cache() -> None:
    _CACHE.clear()
    _LAST_REQUEST.clear()
