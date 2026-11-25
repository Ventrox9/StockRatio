from datetime import date

from stockratio.signals import (backfill, is_signal, months_ago, past_consensus, run,
                                update_episodes, update_prices)

STRONG = {"s": "AAA", "n": "A", "px": 100.0, "score": 96, "rec": 1.4, "nA": 10, "sVal": 60}
WEAK = {"s": "AAA", "n": "A", "px": 90.0, "score": 50, "rec": 2.8, "nA": 10, "sVal": 60}


def test_rules():
    assert is_signal("score95", STRONG) and is_signal("strongbuy", STRONG) and is_signal("buy", STRONG)
    assert not any(is_signal(k, WEAK) for k in ("score95", "strongbuy", "buy"))
    assert not is_signal("strongbuy", {**STRONG, "nA": 2})
    assert not is_signal("score95", {**STRONG, "type": "ETF"})


def test_episode_opens_ends_and_reopens_without_flicker():
    st = {"e": []}
    update_episodes(st, [STRONG], date(2026, 11, 2))
    assert len(st["e"]) == 3 and all(e["p0"] == 100.0 and e["d1"] is None for e in st["e"])
    update_episodes(st, [WEAK], date(2026, 11, 3))
    assert all(e["d1"] == "2026-11-03" and e["p1"] == 90.0 for e in st["e"])
    update_episodes(st, [STRONG], date(2026, 11, 6))  # back within 7 days -> same episode
    assert len(st["e"]) == 3 and all(e["d1"] is None for e in st["e"])
    update_episodes(st, [WEAK], date(2026, 11, 9))
    update_episodes(st, [STRONG], date(2026, 11, 30))  # much later -> new episode
    assert len(st["e"]) == 6


def test_stale_data_changes_nothing():
    st = {"e": []}
    update_episodes(st, [STRONG], date(2026, 11, 2))
    update_episodes(st, [{**WEAK, "stale": "2026-11-01"}], date(2026, 11, 3))
    assert all(e["d1"] is None for e in st["e"])


def test_backfill_from_monthly_analyst_history():
    # today: consensus 1.8 with distribution mean 2.0; earlier the distribution was much better
    s = {**WEAK, "rec": 1.8, "dist": [2, 6, 2, 0, 0],
         "distH": [[6, 4, 0, 0, 0], [6, 4, 0, 0, 0], [2, 6, 2, 0, 0]]}  # -1m, -2m, -3m
    assert abs(past_consensus(s, [6, 4, 0, 0, 0]) - 1.2) < 1e-9  # 1.8 + (1.4 - 2.0)
    st = {"e": []}
    backfill(st, [s], date(2026, 11, 25))
    (ep,) = st["e"]
    assert ep["d0"] == "2026-09-25" and ep["d1"] == "2026-11-25" and ep["bf"] == 1 and ep["p0"] is None


def test_prices_horizons_and_extremes():
    st = {"e": []}
    update_episodes(st, [STRONG], date(2026, 1, 1))
    series = [("2026-01-01", 100.0), ("2026-01-05", 120.0), ("2026-01-08", 95.0), ("2026-02-03", 110.0)]
    sp = [("2025-12-31", 1000.0), ("2026-01-08", 1010.0), ("2026-02-03", 1050.0)]
    update_prices(st, {"AAA": series, "^GSPC": sp}, date(2026, 2, 3))
    ep = st["e"][0]
    assert ep["sp0"] == 1000.0 and ep["hi"] == 0.2 and ep["lo"] == -0.05
    assert ep["r"] == {"7": -0.05, "30": -0.05} and ep["rs"] == {"7": 0.01, "30": 0.01}  # day 30 = 31.1.
    assert ep["last"] == 110.0


def test_first_run_sets_start_and_backfills():
    s = {**STRONG, "dist": [8, 2, 0, 0, 0], "distH": [[8, 2, 0, 0, 0]] * 3}
    st = run({}, [s], date(2026, 11, 25), history=None)
    assert st["since"] == "2026-11-25"
    kinds = sorted(e["k"] for e in st["e"])
    assert kinds == ["buy", "score95", "strongbuy"]  # strong buy continues the backfilled episode
    assert next(e for e in st["e"] if e["k"] == "strongbuy")["d0"] == "2026-08-25"


def test_months_ago_clamps_day():
    assert months_ago(date(2026, 5, 31), 3) == date(2026, 2, 28)
