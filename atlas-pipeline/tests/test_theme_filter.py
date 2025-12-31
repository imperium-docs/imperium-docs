from __future__ import annotations

from theme_filter import evaluate_theme


def test_theme_filter_ipo():
    decision = evaluate_theme(
        "Company filed for an IPO and listed on NYSE",
        "The firm filed for an IPO with the SEC in 2025.",
        "",
    )
    assert decision is not None
    assert decision.theme == "ipo"


def test_theme_filter_billionaire():
    decision = evaluate_theme(
        "Jane Doe became a billionaire",
        "Her net worth reached $1 billion, per Forbes.",
        "",
    )
    assert decision is not None
    assert decision.theme == "billionaire"


def test_theme_filter_revenue_record():
    decision = evaluate_theme(
        "Company posts record revenue",
        "The company reported the highest revenue ever in Q1 2025 earnings.",
        "",
    )
    assert decision is not None
    assert decision.theme == "revenue_record"


def test_theme_filter_rejects_ambiguous():
    decision = evaluate_theme(
        "Company filed for an IPO and record revenue",
        "The firm reported record revenue and filed for an IPO.",
        "",
    )
    assert decision is None
