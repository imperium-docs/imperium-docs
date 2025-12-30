from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ATLAS_SITE_DIR = REPO_ROOT / "atlas-site"

FEED_PATH = ATLAS_SITE_DIR / "feed.json"
STATE_PATH = ATLAS_SITE_DIR / "state.json"
CONTENT_FEED_PATH = ATLAS_SITE_DIR / "content" / "atlas" / "feed.json"
CONTENT_STATE_PATH = ATLAS_SITE_DIR / "content" / "atlas" / "state.json"

SOURCES_PATH = ATLAS_SITE_DIR / "sources.whitelist.json"

ALLOWED_EVENT_TYPES = {"billionaire", "ipo", "revenue_record"}

MAX_ITEMS = int(os.getenv("ATLAS_MAX_ITEMS", "200"))
MAX_PER_SOURCE = int(os.getenv("ATLAS_MAX_PER_SOURCE", "8"))

SYNC_CONTENT_ATLAS = os.getenv("ATLAS_SYNC_CONTENT_ATLAS", "true").lower() == "true"

LLM_ENABLED = os.getenv("ATLAS_LLM_ENABLED", "false").lower() == "true"
LLM_PROVIDER = (os.getenv("ATLAS_LLM_PROVIDER") or "openrouter").lower()
OPENROUTER_MODEL = os.getenv("ATLAS_LLM_MODEL") or "meta-llama/llama-3.2-3b-instruct:free"
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

USER_AGENT = os.getenv("ATLAS_USER_AGENT", "Atlas/1.0")
