import numpy as np
import pandas as pd

from stockratio.scoring import label_for, score


def make_universe(n=60, seed=1):
    rng = np.random.default_rng(seed)
    return pd.DataFrame({
        "s": [f"S{i}" for i in range(n)],
        "sec": ["Technology" if i % 2 else "Utilities" for i in range(n)],
        "pe": rng.uniform(5, 50, n), "fpe": rng.uniform(5, 40, n), "peg": rng.uniform(0.3, 4, n),
        "evEbitda": rng.uniform(3, 30, n), "fcfY": rng.uniform(-0.02, 0.1, n),
        "roe": rng.uniform(-0.1, 0.4, n), "opm": rng.uniform(-0.1, 0.4, n), "npm": rng.uniform(-0.1, 0.3, n),
        "de": rng.uniform(0, 3, n), "revG": rng.uniform(-0.1, 0.3, n), "epsG": rng.uniform(-0.3, 0.5, n),
        "epsGny": rng.uniform(-0.1, 0.3, n), "rec": rng.uniform(1, 4, n), "nA": rng.integers(0, 40, n),
        "up": rng.uniform(-0.2, 0.5, n), "rev90": rng.uniform(-0.1, 0.1, n),
        "rel52": rng.uniform(-0.3, 0.4, n), "ma200": rng.uniform(-0.2, 0.3, n),
    })


def test_scores_are_percentiles_with_labels():
    df = score(make_universe())
    assert df["score"].between(0, 100).all()
    assert df["score"].max() == 100
    assert set(df["label"]) <= {"Kaufkandidat", "Positiv", "Neutral", "Negativ", "Meiden"}


def test_cheaper_stock_gets_better_valuation_score():
    df = make_universe()
    cheap, pricey = 0, 2  # same sector
    df.loc[cheap, ["pe", "fpe", "peg", "evEbitda", "fcfY"]] = [6, 5, 0.3, 3, 0.1]
    df.loc[pricey, ["pe", "fpe", "peg", "evEbitda", "fcfY"]] = [49, 39, 3.9, 29, -0.02]
    out = score(df)
    assert out.loc[cheap, "sVal"] > 90
    assert out.loc[pricey, "sVal"] < 10


def test_negative_earnings_rank_as_expensive():
    df = make_universe()
    df.loc[0, ["pe", "fpe"]] = [-1.0, -1.0]
    out = score(df)
    assert out.loc[0, "sVal"] < out["sVal"].median()


def test_labels():
    assert label_for(95) == "Kaufkandidat"
    assert label_for(75) == "Positiv"
    assert label_for(50) == "Neutral"
    assert label_for(20) == "Negativ"
    assert label_for(5) == "Meiden"
    assert label_for(float("nan")) is None
