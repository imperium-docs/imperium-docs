from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class EvidenceSummary:
    total: int
    primary: int
    secondary: int
    research: int
    reasons: list[str]


def summarize_evidence(items: list[dict[str, Any]]) -> EvidenceSummary:
    primary = sum(1 for item in items if item["source"].tier == "primary")
    secondary = sum(1 for item in items if item["source"].tier == "secondary")
    research = sum(1 for item in items if item["source"].tier not in ("primary", "secondary"))
    total = primary + secondary + research
    reasons: list[str] = []
    if total >= 5:
        reasons.append("min_sources_met")
    if primary >= 2 and secondary >= 3:
        reasons.append("primary_secondary_met")
    return EvidenceSummary(total=total, primary=primary, secondary=secondary, research=research, reasons=reasons)


def evidence_passes(summary: EvidenceSummary) -> bool:
    return summary.total >= 5 or (summary.primary >= 2 and summary.secondary >= 3)
