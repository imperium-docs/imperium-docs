from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import requests

from config import LLM_ENABLED, LLM_PROVIDER, OPENROUTER_API_KEY, OPENROUTER_MODEL


@dataclass(frozen=True)
class LlmResult:
    title: str
    dek: str
    body: str
    checklist: list[str]


def _call_openrouter(messages: list[dict[str, str]]) -> str:
    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY missing")
    response = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "X-Title": "Atlas",
            "HTTP-Referer": "https://atlas.local",
        },
        json={
            "model": OPENROUTER_MODEL,
            "max_tokens": 700,
            "temperature": 0.2,
            "messages": messages,
        },
        timeout=35,
    )
    response.raise_for_status()
    payload = response.json()
    content = payload.get("choices", [{}])[0].get("message", {}).get("content")
    if not content:
        raise RuntimeError("LLM returned empty response")
    return str(content).strip()


def generate(event: dict[str, Any]) -> LlmResult | None:
    if not LLM_ENABLED:
        return None
    if LLM_PROVIDER != "openrouter":
        raise RuntimeError("LLM provider must be openrouter")
    system_prompt = (
        "You are Atlas cognition. Produce JSON with keys: title, dek, body, checklist."
        "Checklist must be an array of short strings."
    )
    sources = [item["source"].name for item in event["items"]]
    user_prompt = json.dumps(
        {
            "event_type": event["event_type"],
            "entity": event["entity"],
            "evidence_sources": sources,
            "facts": [item["title"] for item in event["items"]],
        },
        ensure_ascii=True,
    )
    raw = _call_openrouter(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
    )
    try:
        payload = json.loads(raw)
        return LlmResult(
            title=str(payload.get("title") or "").strip(),
            dek=str(payload.get("dek") or "").strip(),
            body=str(payload.get("body") or "").strip(),
            checklist=list(payload.get("checklist") or []),
        )
    except Exception as exc:
        raise RuntimeError(f"LLM output invalid: {exc}") from exc


def verify_theme(event: dict[str, Any], theme: str) -> bool | None:
    if not LLM_ENABLED:
        return None
    if LLM_PROVIDER != "openrouter":
        raise RuntimeError("LLM provider must be openrouter")
    system_prompt = (
        "You are a strict verifier. Reply only with 'SIM' or 'NAO'. "
        "Answer SIM only if the event is unequivocally about the specified theme."
    )
    user_prompt = json.dumps(
        {
            "theme": theme.upper(),
            "title": event.get("title"),
            "summary": event.get("summary"),
            "content": event.get("content"),
            "link": event.get("link"),
        },
        ensure_ascii=True,
    )
    raw = _call_openrouter(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
    )
    return raw.strip().lower().startswith("sim")
