from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable


IPO_KEYWORDS = [
    r"filed for an ipo",
    r"initial public offering",
    r"ipo filing",
    r"registration statement",
    r"prospectus",
    r"began trading",
    r"listed on",
]

BILLIONAIRE_KEYWORDS = [
    r"became a billionaire",
    r"joined the billionaires",
    r"net worth reached \$?1\s*billion",
    r"entered the billionaire ranking",
]

REVENUE_KEYWORDS = [
    r"record revenue",
    r"highest revenue ever",
    r"all[- ]time high revenue",
    r"largest revenue in its history",
]

HTML_RE = re.compile(r"<[^>]+>")
MONEY_RE = re.compile(r"(\$|usd)\s?[0-9][0-9,\.]*(\s*(billion|bn|million|m))?", re.IGNORECASE)
YEAR_RE = re.compile(r"\b20[0-9]{2}\b")
PERIOD_RE = re.compile(r"\b(q[1-4]|fy[0-9]{2,4}|annual|quarterly|full[- ]year)\b", re.IGNORECASE)
TICKER_RE = re.compile(r"\([A-Z]{1,5}\)")
NAME_RE = re.compile(r"\b[A-Z][a-z]+ [A-Z][a-z]+(?: [A-Z][a-z]+)?\b")


@dataclass(frozen=True)
class ThemeDecision:
    theme: str
    evidences: list[str]


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", HTML_RE.sub(" ", text)).strip()


def _lower(text: str) -> str:
    return _clean_text(text).lower()


def _matches_any(text: str, patterns: Iterable[str]) -> bool:
    return any(re.search(pattern, text) for pattern in patterns)


def _has_money(text: str) -> bool:
    return bool(MONEY_RE.search(text))


def _has_billion_value(text: str) -> bool:
    return bool(re.search(r"\$?\s*1(\.0+)?\s*(billion|bn)\b", text, re.IGNORECASE))


def _has_date(text: str) -> bool:
    return bool(YEAR_RE.search(text) or PERIOD_RE.search(text))


def _extract_evidence_tokens(text: str, original: str) -> dict[str, bool]:
    return {
        "money": _has_money(text),
        "billion_value": _has_billion_value(text),
        "date": _has_date(text),
        "ticker": bool(TICKER_RE.search(original)),
        "person_name": bool(NAME_RE.search(original)),
        "regulator_or_exchange": any(
            token in text
            for token in [
                "sec",
                "nyse",
                "nasdaq",
                "euronext",
                "lseg",
                "b3",
                "tsx",
                "asx",
                "nse",
                "jpx",
                "hkex",
                "fca",
                "esma",
                "bafin",
                "amf",
                "cvm",
                "sebi",
                "asic",
                "mas",
            ]
        ),
        "ranking_source": any(
            token in text
            for token in [
                "forbes",
                "bloomberg billionaire",
                "bloomberg billionaires index",
                "sunday times rich",
            ]
        ),
        "earnings_release": any(token in text for token in ["earnings", "results", "financial statements"]),
    }


def evaluate_theme(title: str, summary: str, content: str) -> ThemeDecision | None:
    raw = _clean_text(" ".join([title, summary, content]))
    lowered = raw.lower()
    evidences = _extract_evidence_tokens(lowered, raw)

    candidates: list[ThemeDecision] = []

    if _matches_any(lowered, IPO_KEYWORDS):
        evidence_list = []
        if evidences["regulator_or_exchange"]:
            evidence_list.append("regulator_or_exchange")
        if evidences["ticker"]:
            evidence_list.append("ticker")
        if evidences["date"]:
            evidence_list.append("date")
        if evidence_list:
            candidates.append(ThemeDecision(theme="ipo", evidences=evidence_list))

    if _matches_any(lowered, BILLIONAIRE_KEYWORDS):
        evidence_list = []
        if evidences["billion_value"]:
            evidence_list.append("explicit_billion_value")
        if evidences["person_name"]:
            evidence_list.append("person_name")
        if evidences["ranking_source"]:
            evidence_list.append("ranking_source")
        if evidence_list:
            candidates.append(ThemeDecision(theme="billionaire", evidences=evidence_list))

    if _matches_any(lowered, REVENUE_KEYWORDS):
        evidence_list = []
        if evidences["money"]:
            evidence_list.append("explicit_value")
        if evidences["date"]:
            evidence_list.append("period")
        if evidences["earnings_release"]:
            evidence_list.append("earnings_release")
        if evidence_list:
            candidates.append(ThemeDecision(theme="revenue_record", evidences=evidence_list))

    if len(candidates) != 1:
        return None
    return candidates[0]
