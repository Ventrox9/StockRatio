"""StockRatio-Score: a transparent 0–100 rating built from five pillars.

Every metric is converted into a percentile (0 = worst, 100 = best) across all
screened stocks. Valuation and leverage are additionally compared within the
stock's sector, because a P/E of 25 is cheap for software but expensive for a
bank. Pillar scores are weighted averages of the available metrics; the total
score re-normalises the weights if a pillar is missing.

Pillar scores and the total are finally re-ranked into percentiles, so a score
of 80 means "more attractive than 80 % of all screened stocks". The signal is
therefore relative: the top 10 % are "Kaufkandidat", the bottom 10 % "Meiden".
"""

from __future__ import annotations

import numpy as np
import pandas as pd

PILLAR_WEIGHTS = {
    "val": 0.30,  # Bewertung
    "qual": 0.20,  # Qualität
    "grow": 0.15,  # Wachstum
    "ana": 0.25,  # Analysten
    "mom": 0.10,  # Momentum / relative Stärke
}

MIN_SECTOR_SIZE = 10
SECTOR_SHARE = 0.7  # valuation: 70 % vs. sector, 30 % vs. whole universe

LABELS = [  # (min score, label) – score is a percentile
    (90, "Kaufkandidat"),
    (70, "Positiv"),
    (30, "Neutral"),
    (10, "Negativ"),
    (0, "Meiden"),
]


def _pct(series: pd.Series, higher_is_better: bool) -> pd.Series:
    ranked = series.rank(pct=True, ascending=higher_is_better, method="average")
    return ranked * 100


def _sector_pct(df: pd.DataFrame, col: str, higher_is_better: bool) -> pd.Series:
    overall = _pct(df[col], higher_is_better)
    sector_size = df.groupby("sec")[col].transform("count")
    in_sector = df.groupby("sec")[col].transform(lambda s: _pct(s, higher_is_better))
    blended = SECTOR_SHARE * in_sector + (1 - SECTOR_SHARE) * overall
    return blended.where(sector_size >= MIN_SECTOR_SIZE, overall)


def _valuation_metric(df: pd.DataFrame, col: str) -> pd.Series:
    """Lower is better; negative earnings (-1 sentinel) score 0."""
    positive = df[col].where(df[col] > 0)
    score = _sector_pct(df.assign(**{col: positive}), col, higher_is_better=False)
    return score.mask(df[col] < 0, 0.0)


def _weighted(parts: dict[str, tuple[pd.Series, float]]) -> pd.Series:
    num = None
    den = None
    for series, weight in parts.values():
        w = series.notna() * weight
        v = series.fillna(0) * weight
        num = v if num is None else num + v
        den = w if den is None else den + w
    return (num / den.replace(0, np.nan)).where(den >= 0.35)


def score(df: pd.DataFrame) -> pd.DataFrame:
    """Adds pillar scores (sVal, sQual, sGrow, sAna, sMom), total `score` and `label`."""
    df = df.copy()

    df["sVal"] = _weighted(
        {
            "fpe": (_valuation_metric(df, "fpe"), 0.30),
            "peg": (_sector_pct(df, "peg", higher_is_better=False), 0.20),
            "pe": (_valuation_metric(df, "pe"), 0.15),
            "evEbitda": (_sector_pct(df, "evEbitda", higher_is_better=False), 0.15),
            "fcfY": (_sector_pct(df, "fcfY", higher_is_better=True), 0.20),
        }
    )

    df["sQual"] = _weighted(
        {
            "roe": (_pct(df["roe"], True), 0.35),
            "opm": (_sector_pct(df, "opm", True), 0.30),
            "npm": (_pct(df["npm"], True), 0.15),
            "de": (_sector_pct(df, "de", False), 0.20),
        }
    )

    df["sGrow"] = _weighted(
        {
            "revG": (_pct(df["revG"], True), 0.35),
            "epsGny": (_pct(df["epsGny"], True), 0.40),
            "epsG": (_pct(df["epsG"], True), 0.25),
        }
    )

    # Analyst consensus: 1 = Strong Buy … 5 = Sell, shrunk towards neutral when few analysts cover it.
    consensus = (5 - df["rec"]) / 4 * 100
    confidence = df["nA"] / (df["nA"] + 4)
    consensus = 50 + (consensus - 50) * confidence
    consensus = consensus.where(df["nA"] > 0)
    df["sAna"] = _weighted(
        {
            "rec": (consensus, 0.50),
            "up": (_pct(df["up"].where(df["nA"] > 0), True), 0.30),
            "rev90": (_pct(df["rev90"], True), 0.20),
        }
    )

    df["sMom"] = _weighted(
        {
            "rel52": (_pct(df["rel52"], True), 0.60),
            "ma200": (_pct(df["ma200"], True), 0.40),
        }
    )

    pillar_cols = ["s" + _cap(k) for k in PILLAR_WEIGHTS]
    for col in pillar_cols:
        df[col] = _pct(df[col], True)
    pillars = {k: (df["s" + _cap(k)], w) for k, w in PILLAR_WEIGHTS.items()}
    available = sum(df[c].notna().astype(int) for c in pillar_cols)
    eligible = (available >= 4) & df["sVal"].notna()
    df["score"] = _pct(_weighted(pillars).where(eligible), True)

    for col in ["sVal", "sQual", "sGrow", "sAna", "sMom", "score"]:
        df[col] = df[col].round(0)
    df["label"] = df["score"].map(label_for)
    return df


def _cap(key: str) -> str:
    return key[0].upper() + key[1:]


def label_for(value) -> str | None:
    if value is None or pd.isna(value):
        return None
    for threshold, name in LABELS:
        if value >= threshold:
            return name
    return LABELS[-1][1]


def sector_medians(df: pd.DataFrame) -> dict[str, dict[str, float]]:
    cols = ["pe", "fpe", "peg", "pb", "ps", "evEbitda", "fcfY", "divY", "roe", "opm", "revG", "epsGny"]
    out: dict[str, dict[str, float]] = {}

    def med(frame: pd.DataFrame) -> dict[str, float]:
        res = {}
        for c in cols:
            s = frame[c]
            if c in ("pe", "fpe", "peg"):
                s = s.where(s > 0)
            m = s.median()
            if pd.notna(m):
                res[c] = round(float(m), 4)
        return res

    for sector, frame in df.groupby("sec"):
        if sector:
            out[str(sector)] = med(frame)
    out["_all"] = med(df)
    return out
