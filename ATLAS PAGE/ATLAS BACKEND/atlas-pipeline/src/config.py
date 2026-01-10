from __future__ import annotations

import os
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parents[1]


def resolve_atlas_site_dir(start: Path) -> Path:
    override = os.getenv("ATLAS_SITE_DIR")
    if override:
        return Path(override).expanduser()
    for parent in (start, *start.parents):
        candidate = parent / "atlas-site"
        if candidate.is_dir():
            return candidate
    return start / "atlas-site"


ATLAS_SITE_DIR = resolve_atlas_site_dir(PIPELINE_ROOT)

FEED_PATH = ATLAS_SITE_DIR / "feed.json"
STATE_PATH = ATLAS_SITE_DIR / "state.json"

SOURCES_PATH = ATLAS_SITE_DIR / "sources.whitelist.json"

ALLOWED_EVENT_TYPES = {"billionaire", "ipo", "revenue_record"}

CANONICAL_DOMAINS = {
    "sec.gov",
    "fca.org.uk",
    "esma.europa.eu",
    "bafin.de",
    "amf-france.org",
    "cvm.gov.br",
    "sebi.gov.in",
    "asic.gov.au",
    "mas.gov.sg",
    "nyse.com",
    "nasdaq.com",
    "lseg.com",
    "euronext.com",
    "jpx.co.jp",
    "hkex.com.hk",
    "b3.com.br",
    "tsx.com",
    "asx.com.au",
    "nseindia.com",
    "reuters.com",
    "bloomberg.com",
    "apnews.com",
    "afp.com",
    "ft.com",
    "wsj.com",
    "economist.com",
    "barrons.com",
    "marketwatch.com",
    "handelsblatt.com",
    "lesechos.fr",
    "ilsole24ore.com",
    "forbes.com",
    "thesundaytimes.co.uk",
    "spglobal.com",
    "morningstar.com",
    "factset.com",
    "pitchbook.com",
}

FEED_VERSION = int(os.getenv("ATLAS_FEED_VERSION", "4"))
STATE_VERSION = int(os.getenv("ATLAS_STATE_VERSION", "4"))

MAX_ITEMS = int(os.getenv("ATLAS_MAX_ITEMS", "3"))
MAX_PER_SOURCE = int(os.getenv("ATLAS_MAX_PER_SOURCE", "12"))
HTML_MAX_LINKS = int(os.getenv("ATLAS_HTML_MAX_LINKS", "50"))
SITEMAP_MAX_LINKS = int(os.getenv("ATLAS_SITEMAP_MAX_LINKS", "100"))

SYNC_CONTENT_ATLAS = os.getenv("ATLAS_SYNC_CONTENT_ATLAS", "false").lower() == "true"

WINDOW_HOURS = [48, 24 * 7, 24 * 30]
LONG_WINDOW_MIN_SCORE = float(os.getenv("ATLAS_LONG_WINDOW_MIN_SCORE", "2.5"))
MIN_BODY_LENGTH = int(os.getenv("ATLAS_MIN_BODY_LENGTH", "500"))

LOG_DIR = PIPELINE_ROOT / "logs"

LLM_ENABLED = os.getenv("ATLAS_LLM_ENABLED", "false").lower() == "true"
LLM_PROVIDER = (os.getenv("ATLAS_LLM_PROVIDER") or "openrouter").lower()
OPENROUTER_MODEL = os.getenv("ATLAS_LLM_MODEL") or "meta-llama/llama-3.2-3b-instruct:free"
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

USER_AGENT = os.getenv("ATLAS_USER_AGENT", "Atlas/1.0")
