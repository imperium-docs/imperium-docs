from __future__ import annotations

import re
from typing import Optional

import httpx

from app.core.errors import ErrorType, ProviderError

QUOTA_PATTERNS = [
    re.compile(r"quota", re.IGNORECASE),
    re.compile(r"rate limit", re.IGNORECASE),
    re.compile(r"too many requests", re.IGNORECASE),
]
AUTH_PATTERNS = [
    re.compile(r"unauthorized", re.IGNORECASE),
    re.compile(r"forbidden", re.IGNORECASE),
    re.compile(r"invalid api key", re.IGNORECASE),
]
TRANSIENT_PATTERNS = [
    re.compile(r"temporarily", re.IGNORECASE),
    re.compile(r"try again", re.IGNORECASE),
    re.compile(r"timeout", re.IGNORECASE),
]
UNSUPPORTED_PATTERNS = [
    re.compile(r"unsupported", re.IGNORECASE),
    re.compile(r"not implemented", re.IGNORECASE),
]


def classify_exception(exc: Exception) -> ProviderError:
    if isinstance(exc, ProviderError):
        return exc
    if isinstance(exc, httpx.TimeoutException):
        return ProviderError(str(exc), ErrorType.timeout)
    if isinstance(exc, httpx.RequestError):
        return ProviderError(str(exc), ErrorType.server_down)
    if isinstance(exc, httpx.HTTPStatusError):
        return ProviderError(str(exc), classify_status_code(exc.response.status_code))
    return ProviderError(str(exc), ErrorType.unknown)


def classify_message(message: Optional[str]) -> ErrorType:
    if not message:
        return ErrorType.unknown
    for pattern in QUOTA_PATTERNS:
        if pattern.search(message):
            return ErrorType.quota
    for pattern in AUTH_PATTERNS:
        if pattern.search(message):
            return ErrorType.auth
    for pattern in UNSUPPORTED_PATTERNS:
        if pattern.search(message):
            return ErrorType.unsupported
    for pattern in TRANSIENT_PATTERNS:
        if pattern.search(message):
            return ErrorType.transient
    return ErrorType.unknown


def classify_status_code(status_code: int) -> ErrorType:
    if status_code in {401, 403}:
        return ErrorType.auth
    if status_code in {404, 405, 422}:
        return ErrorType.unsupported
    if status_code in {408, 500, 502, 503, 504}:
        return ErrorType.transient
    if status_code in {429}:
        return ErrorType.quota
    if status_code >= 500:
        return ErrorType.server_down
    return ErrorType.unknown
