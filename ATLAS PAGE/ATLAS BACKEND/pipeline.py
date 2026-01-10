import argparse
import calendar
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import feedparser
import requests
from bs4 import BeautifulSoup

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_FEEDS_PATH = BASE_DIR / "feeds.json"
DEFAULT_OUTPUT_DIR = BASE_DIR.parent / "ATLAS FRONT END" / "data"

USER_AGENT = "AtlasPipeline/1.0 (+https://example.invalid)"


def load_feeds(path: Path) -> list:
    if not path.exists():
        raise FileNotFoundError(f"Feeds file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    feeds = payload.get("feeds", [])
    if not feeds:
        raise ValueError("feeds.json has no feeds")
    return feeds


def clean_text(value: str) -> str:
    if not value:
        return ""
    soup = BeautifulSoup(value, "html.parser")
    text = soup.get_text(" ")
    return " ".join(text.split())


def to_iso(entry: dict) -> str:
    for key in ("published_parsed", "updated_parsed"):
        parsed = entry.get(key)
        if parsed:
            ts = calendar.timegm(parsed)
            return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    return ""


def hash_id(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]


def fetch_feed(url: str) -> bytes:
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=20)
    response.raise_for_status()
    return response.content


def parse_feed(feed: dict, content: bytes) -> list:
    parsed = feedparser.parse(content)
    items = []
    for entry in parsed.entries:
        title = clean_text(entry.get("title", ""))
        link = entry.get("link", "")
        summary = clean_text(entry.get("summary", "") or entry.get("description", ""))
        published = to_iso(entry)
        source = clean_text(parsed.feed.get("title", "")) or feed.get("name", "")
        category = feed.get("category", "")
        key = link or title
        if not key:
            continue
        items.append(
            {
                "id": hash_id(key),
                "title": title,
                "url": link,
                "summary": summary,
                "published": published,
                "source": source,
                "category": category,
                "score": 0,
                "tags": [],
            }
        )
    return items


def score_item(item: dict) -> int:
    score = 0
    title = (item.get("title") or "").lower()
    category = (item.get("category") or "").lower()

    hot_terms = [
        "breaking",
        "urgent",
        "exclusive",
        "alert",
        "security",
        "market",
        "election",
        "policy",
        "rate",
        "inflation",
        "war",
    ]
    for term in hot_terms:
        if term in title:
            score += 3
    if category in {"markets", "policy", "security", "energy", "ai"}:
        score += 2

    published = item.get("published")
    if published:
        try:
            dt = datetime.fromisoformat(published)
            delta = datetime.now(timezone.utc) - dt
            if delta.total_seconds() < 6 * 3600:
                score += 4
            elif delta.total_seconds() < 24 * 3600:
                score += 2
        except ValueError:
            pass
    return score


def rank_items(items: list) -> list:
    for item in items:
        item["score"] = score_item(item)
    items.sort(key=lambda x: (x.get("score", 0), x.get("published", "")), reverse=True)
    return items


def openai_enrich(items: list, api_key: str, model: str, max_items: int) -> None:
    if not api_key:
        return

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    system_prompt = (
        "You are a newsroom editor. Return JSON only with keys: "
        "summary (max 260 chars), category (one word), tags (array), importance (1-5)."
    )

    for item in items[:max_items]:
        user_prompt = {
            "title": item.get("title", ""),
            "summary": item.get("summary", ""),
            "source": item.get("source", ""),
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_prompt)},
            ],
            "temperature": 0.2,
        }
        try:
            response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=30,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
        except Exception:
            continue

        if not content:
            continue

        start = content.find("{")
        end = content.rfind("}")
        if start == -1 or end == -1:
            continue

        try:
            enriched = json.loads(content[start : end + 1])
        except json.JSONDecodeError:
            continue

        if isinstance(enriched.get("summary"), str):
            item["summary"] = enriched["summary"]
        if isinstance(enriched.get("category"), str):
            item["category"] = enriched["category"]
        if isinstance(enriched.get("tags"), list):
            item["tags"] = enriched["tags"]
        if isinstance(enriched.get("importance"), int):
            item["importance"] = enriched["importance"]


def write_output(items: list, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "items": items,
    }
    output_path = output_dir / "news.json"
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=True, indent=2)
    return output_path


def run_once(args: argparse.Namespace) -> int:
    feeds = load_feeds(Path(args.feeds))
    all_items = []

    for feed in feeds:
        url = feed.get("url")
        if not url:
            continue
        try:
            content = fetch_feed(url)
            items = parse_feed(feed, content)
            all_items.extend(items)
        except Exception:
            continue

    if not all_items:
        print("No items found")
        return 1

    deduped = {}
    for item in all_items:
        key = item.get("url") or item.get("title")
        if not key:
            continue
        deduped[key] = item

    items = rank_items(list(deduped.values()))

    api_key = os.getenv("OPENAI_API_KEY")
    ai_enabled = not args.no_ai and bool(api_key)
    if args.ai:
        ai_enabled = True

    if ai_enabled and api_key:
        openai_enrich(items, api_key, args.model, args.ai_max)
    elif args.ai and not api_key:
        print("AI requested but OPENAI_API_KEY is not set")

    output_path = write_output(items, Path(args.output))
    print(f"Wrote {len(items)} items to {output_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Atlas news pipeline")
    parser.add_argument("--feeds", default=str(DEFAULT_FEEDS_PATH), help="Path to feeds.json")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_DIR), help="Output directory")
    parser.add_argument("--ai", action="store_true", help="Force AI enrichment (requires OPENAI_API_KEY)")
    parser.add_argument("--no-ai", action="store_true", help="Disable AI enrichment")
    parser.add_argument("--ai-max", type=int, default=20, help="Max items to enrich")
    parser.add_argument("--model", default="gpt-4o-mini", help="OpenAI model name")
    parser.add_argument("--loop", type=int, default=0, help="Loop interval in seconds (0 = run once)")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.loop > 0:
        while True:
            code = run_once(args)
            if code != 0:
                print("Run completed with errors")
            time.sleep(args.loop)
    else:
        return run_once(args)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
